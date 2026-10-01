const ISSUE_TAGS = ["结论模糊", "论据不足", "因果跳跃", "分类重叠", "缺少边界", "表达冗余"];
const SCORE_KEYS = ["claim", "evidence", "structure", "reasoning", "expression"];
const BACKUP_APP = "logical-thinking-training";
const validScores = (scores) => scores && typeof scores === "object" && SCORE_KEYS.every((key) => Number.isFinite(scores[key]) && scores[key] >= 0 && scores[key] <= 20);

function getIssueTags(feedback) {
  return (Array.isArray(feedback?.issues) ? feedback.issues : []).map((issue) => issue?.tag).filter((tag) => ISSUE_TAGS.includes(tag));
}

function buildWeeklyReview(records, now = new Date()) {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6).getTime();
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime();
  const recent = records.filter((record) => {
    const time = new Date(record.createdAt).getTime();
    return record.type === "checkin" && record.meta?.provider === "deepseek" && time >= start && time < end;
  });
  const tagCounts = Object.fromEntries(ISSUE_TAGS.map((tag) => [tag, 0]));
  const gains = Object.fromEntries(SCORE_KEYS.map((key) => [key, 0]));
  let gainTotal = 0;
  let compared = 0;

  for (const record of recent) {
    const tags = new Set([...getIssueTags(record.firstFeedback), ...getIssueTags(record.secondFeedback)]);
    tags.forEach((tag) => { tagCounts[tag] += 1; });
    if (!validScores(record.firstFeedback?.scores) || !validScores(record.scores) || !Number.isFinite(record.firstFeedback.total) || !Number.isFinite(record.score)) continue; // 旧记录没有保存初答，不能推测进步。
    compared += 1;
    gainTotal += Number(record.score) - Number(record.firstFeedback.total);
    SCORE_KEYS.forEach((key) => { gains[key] += Number(record.scores[key]) - Number(record.firstFeedback.scores[key]); });
  }

  const topTags = Object.entries(tagCounts).filter(([, count]) => count > 0).sort((a, b) => b[1] - a[1]).slice(0, 3);
  const mostImproved = compared ? SCORE_KEYS.reduce((best, key) => gains[key] > gains[best] ? key : best) : null;
  return { sessions: recent.length, compared, averageGain: compared ? Math.round(gainTotal / compared) : null, mostImproved: mostImproved && gains[mostImproved] > 0 ? mostImproved : null, topTags };
}

function createBackup(store) {
  return { app: BACKUP_APP, version: 1, exportedAt: new Date().toISOString(), records: store.records, questionHistory: store.questionHistory };
}

function parseBackup(text) {
  if (text.length > 5 * 1024 * 1024) throw new Error("备份文件不能超过 5 MB");
  let data;
  try { data = JSON.parse(text); } catch { throw new Error("文件不是有效的 JSON"); }
  if (data?.app !== BACKUP_APP || data.version !== 1 || !Array.isArray(data.records) || !Array.isArray(data.questionHistory)) throw new Error("不是受支持的训练数据备份");
  if (data.records.length > 100 || data.questionHistory.length > 100) throw new Error("备份数据超出当前容量限制");
  const validFeedback = (feedback) => feedback === undefined || (feedback && typeof feedback === "object"
    && validScores(feedback.scores) && Number.isFinite(feedback.total) && (feedback.issues === undefined || Array.isArray(feedback.issues)));
  const validRecord = (item) => item && ["checkin", "material"].includes(item.type)
    && (typeof item.id === "number" || typeof item.id === "string")
    && typeof item.title === "string" && typeof item.createdAt === "string" && Number.isFinite(new Date(item.createdAt).getTime())
    && (item.summary === undefined || typeof item.summary === "string")
    && (item.score === undefined || Number.isFinite(item.score))
    && (item.scores === undefined || validScores(item.scores))
    && (item.mode !== "oral" || ([item.oral?.first, item.oral?.second].every((round) => round && Number.isFinite(round.duration) && round.duration > 0 && round.duration <= 120 && typeof round.selfReview === "string")))
    && validFeedback(item.firstFeedback) && validFeedback(item.secondFeedback);
  const validHistory = (item) => item && typeof item.id === "string" && /^\d{4}-\d{2}-\d{2}$/.test(item.date);
  if (!data.records.every(validRecord) || !data.questionHistory.every(validHistory)) throw new Error("备份中的记录格式不正确");
  return { records: data.records, questionHistory: data.questionHistory };
}

if (typeof module !== "undefined") module.exports = { ISSUE_TAGS, getIssueTags, buildWeeklyReview, createBackup, parseBackup };
