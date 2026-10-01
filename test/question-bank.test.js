const test = require("node:test");
const assert = require("node:assert/strict");
const { CATEGORIES, loadQuestions, mergeQuestions, validateQuestions } = require("../server/question-bank");
const { selectQuestion } = require("../public/question-selection");
const { runAiTask, validateResult } = require("../server/ai");

const questions = loadQuestions();

test("36 道案例题覆盖六类能力和三级难度", () => {
  assert.equal(questions.length, 36);
  for (const category of CATEGORIES) {
    const group = questions.filter((item) => item.category === category);
    assert.equal(group.length, 6);
    for (const difficulty of [1, 2, 3]) assert.equal(group.filter((item) => item.difficulty === difficulty).length, 2);
  }
  assert.ok(questions.every((item) => item.context.length >= 80));
});

test("连续三十天每天选题不重复", () => {
  const history = [];
  for (let day = 1; day <= 30; day += 1) {
    const date = `2026-10-${String(day).padStart(2, "0")}`;
    const question = selectQuestion(questions, history, [], date);
    assert.ok(question);
    history.push({ id: question.id, date });
  }
  assert.equal(new Set(history.map((item) => item.id)).size, 30);
});

test("有低分维度时优先选对应能力，且避免四连同类", () => {
  const records = [{ type: "checkin", meta: { provider: "deepseek" }, scores: { claim: 17, evidence: 7, structure: 16, reasoning: 16, expression: 16 } }];
  const picked = selectQuestion(questions, [], records, "2026-10-01");
  assert.ok(picked.skills.includes("evidence"));
  const history = ["CL01", "CL02", "CL03"].map((id) => ({ id, date: "2026-09-30" }));
  assert.notEqual(selectQuestion(questions, history, [], "2026-10-01").category, "提炼结论");
});

test("JSON 导入拒绝重复 ID，合法新题可合并", () => {
  assert.throws(() => mergeQuestions(questions, [questions[0]]), /已有题目 ID/);
  const next = { ...questions[0], id: "CL07" };
  assert.equal(mergeQuestions(questions, [next]).length, 37);
  assert.throws(() => validateQuestions([{ ...next, context: "过短" }]), /材料过短/);
});

test("打卡 Prompt 包含完整案例和本题评分重点", async () => {
  const originalFetch = global.fetch;
  let sent;
  global.fetch = async (_url, options) => {
    sent = JSON.parse(options.body);
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify({ scores: { claim: 12, evidence: 12, structure: 12, reasoning: 12, expression: 12 }, summary: "可继续完善" }) } }] }) };
  };
  try {
    await runAiTask({ type: "checkin", payload: { questionId: "CL01", answer: "我建议先试点，再决定是否延长。" }, apiKey: "test-key" });
    assert.ok(sent.messages[1].content.includes(questions[0].context));
    assert.ok(sent.messages[1].content.includes(questions[0].focus));
  } finally {
    global.fetch = originalFetch;
  }
});

test("评分问题不能把题目材料误当作用户原文", async () => {
  const originalFetch = global.fetch;
  let calls = 0;
  global.fetch = async () => {
    calls += 1;
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify({
      scores: { claim: 12, evidence: 12, structure: 12, reasoning: 12, expression: 12 },
      summary: "测试",
      issues: [{ type: "误引", quote: questions[0].context.slice(0, 16), explanation: "这不是用户作答" }],
    }) } }] }) };
  };
  try {
    await assert.rejects(runAiTask({ type: "checkin", payload: { questionId: "CL01", answer: "我建议先试点再决定是否延长开放时间。" }, apiKey: "test-key" }), /返回内容不完整/);
    assert.equal(calls, 2);
  } finally {
    global.fetch = originalFetch;
  }
});

test("AI 变式只围绕原题生成，并校验材料长度", async () => {
  const originalFetch = global.fetch;
  const variant = { title: "社区活动室是否应开放晚间时段？", context: "某社区活动室目前只在白天开放。最近有居民提出晚间健身的需求，但提出意见的人主要是附近上班族，实际到访人数仍未统计。管理员表示延长开放需要安排清洁和安全巡查，预算只够先试行一个月；周末白天的场地已经较满，工作日午后仍有不少空位。", requirements: questions[0].requirements, focus: questions[0].focus };
  let sent;
  global.fetch = async (_url, options) => {
    sent = JSON.parse(options.body);
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify(variant) } }] }) };
  };
  try {
    const result = await runAiTask({ type: "variant", payload: { questionId: "CL01" }, apiKey: "test-key" });
    assert.equal(result.sourceId, "CL01");
    assert.equal(result.difficulty, 1);
    assert.deepEqual(result.skills, questions[0].skills);
    assert.equal(result.meta.promptVersion, "1.2.1");
    assert.ok(sent.messages[0].content.includes("不能只替换人物、地点和名词"));
    assert.ok(sent.messages[1].content.includes(questions[0].title));
    assert.throws(() => validateResult("variant", { ...variant, context: "太短" }), /返回内容不完整/);
  } finally {
    global.fetch = originalFetch;
  }
});
