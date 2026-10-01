const test = require("node:test");
const assert = require("node:assert/strict");
const { buildWeeklyReview, createBackup, parseBackup } = require("../public/review");
const { validateResult } = require("../server/ai");

const scores = (claim, evidence, structure, reasoning, expression) => ({ claim, evidence, structure, reasoning, expression });

test("近七天复盘统计改写进步和前三个高频问题", () => {
  const records = [
    { id: 1, type: "checkin", title: "题目一", createdAt: "2026-10-01T04:00:00.000Z", meta: { provider: "deepseek" }, score: 75, scores: scores(15, 14, 15, 16, 15), firstFeedback: { total: 65, scores: scores(10, 12, 13, 15, 15), issues: [{ tag: "结论模糊" }, { tag: "论据不足" }] }, secondFeedback: { issues: [{ tag: "论据不足" }] } },
    { id: 2, type: "checkin", title: "题目二", createdAt: "2026-09-29T04:00:00.000Z", meta: { provider: "deepseek" }, score: 80, scores: scores(16, 16, 16, 16, 16), firstFeedback: { total: 76, scores: scores(15, 15, 14, 16, 16), issues: [{ tag: "结论模糊" }, { tag: "缺少边界" }] }, secondFeedback: { issues: [] } },
    { id: 3, type: "checkin", title: "旧题", createdAt: "2026-09-20T04:00:00.000Z", meta: { provider: "deepseek" }, score: 70, scores: scores(14, 14, 14, 14, 14) },
  ];
  const review = buildWeeklyReview(records, new Date("2026-10-01T12:00:00+08:00"));
  assert.equal(review.sessions, 2);
  assert.equal(review.averageGain, 7);
  assert.equal(review.mostImproved, "claim");
  assert.deepEqual(review.topTags, [["结论模糊", 2], ["论据不足", 1], ["缺少边界", 1]]);
});

test("旧记录不虚构初答和改写变化", () => {
  const review = buildWeeklyReview([{ type: "checkin", createdAt: "2026-10-01T04:00:00.000Z", meta: { provider: "deepseek" }, score: 70 }], new Date("2026-10-01T12:00:00+08:00"));
  assert.equal(review.sessions, 1);
  assert.equal(review.compared, 0);
  assert.equal(review.averageGain, null);
});

test("评分问题只保留统一标签，不合适的标签留空", () => {
  const result = validateResult("checkin", { scores: scores(12, 12, 12, 12, 12), summary: "测试", issues: [{ type: "问题", tag: "因果跳跃", quote: "原文" }, { type: "问题", tag: "自造标签", quote: "原文" }] });
  assert.deepEqual(result.issues.map((issue) => issue.tag), ["因果跳跃", ""]);
});

test("备份可往返恢复且不包含会话 API Key", () => {
  const store = { records: [{ id: 1, type: "material", title: "分析", summary: "完成", createdAt: "2026-10-01T04:00:00.000Z", material: "原始材料" }], questionHistory: [{ id: "CL01", date: "2026-10-01" }], apiKey: "secret" };
  const json = JSON.stringify(createBackup(store));
  assert.ok(!json.includes("secret"));
  assert.deepEqual(parseBackup(json), { records: store.records, questionHistory: store.questionHistory });
  assert.throws(() => parseBackup('{"records":[]}'), /不是受支持/);
  assert.throws(() => parseBackup('{bad'), /有效的 JSON/);
  const malformed = createBackup(store);
  malformed.records[0] = { ...malformed.records[0], firstFeedback: { total: "坏数据", scores: {} } };
  assert.throws(() => parseBackup(JSON.stringify(malformed)), /记录格式/);
});
