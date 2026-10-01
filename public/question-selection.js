// 独立于页面的选题规则，便于测试和以后复用到其他端。
function selectQuestion(questions, history, records, dateKey) {
  if (!questions.length) return null;
  const recentIds = new Set(history.map((item) => item.id));
  const fresh = questions.filter((item) => !recentIds.has(item.id));
  const lastSeven = new Set(history.slice(-7).map((item) => item.id));
  const pool = fresh.length ? fresh : questions.filter((item) => !lastSeven.has(item.id));
  let candidates = pool.length ? pool : questions;
  const scored = records.filter((item) => item.type === "checkin" && item.meta?.provider === "deepseek" && item.scores).slice(0, 10);
  const skills = ["claim", "evidence", "structure", "reasoning", "expression"];
  const averages = Object.fromEntries(skills.map((skill) => [skill, scored.length ? scored.reduce((sum, item) => sum + Number(item.scores[skill] || 0), 0) / scored.length : 0]));
  const weakest = scored.length ? skills.reduce((low, skill) => averages[skill] < averages[low] ? skill : low) : null;
  const overall = scored.length ? skills.reduce((sum, skill) => sum + averages[skill], 0) / skills.length : 0;
  const difficulty = !scored.length || overall < 12 ? 1 : overall < 16 ? 2 : 3;
  const recentCategories = history.slice(-3).map((item) => questions.find((question) => question.id === item.id)?.category);
  if (recentCategories.length === 3 && recentCategories.every((category) => category === recentCategories[0])) {
    const otherCategories = candidates.filter((item) => item.category !== recentCategories[0]);
    if (otherCategories.length) candidates = otherCategories;
  }
  const dayNumber = Math.floor(new Date(`${dateKey}T00:00:00`).getTime() / 86400000);

  return [...candidates].sort((a, b) => {
    const rank = (item) => (weakest && item.skills.includes(weakest) ? 5 : 0)
      + (item.difficulty === difficulty ? 2 : item.difficulty < difficulty ? 1 : 0)
      - recentCategories.filter((category) => category === item.category).length * 2;
    return rank(b) - rank(a) || ((a.id.charCodeAt(2) + Number(a.id.slice(2)) + dayNumber) % questions.length) - ((b.id.charCodeAt(2) + Number(b.id.slice(2)) + dayNumber) % questions.length) || a.id.localeCompare(b.id);
  })[0];
}

if (typeof module !== "undefined") module.exports = { selectQuestion };
