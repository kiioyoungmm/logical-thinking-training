const test = require("node:test");
const assert = require("node:assert/strict");
const DeepSeekProvider = require("../server/providers/deepseek");
const { runAiTask, validateResult } = require("../server/ai");

function reply(status, value) {
  return { ok: status >= 200 && status < 300, status, json: async () => value };
}

test("默认使用当前 DeepSeek 模型并解析有效评分", async () => {
  let sentBody;
  const provider = new DeepSeekProvider({
    apiKey: "test-key",
    fetch: async (_url, options) => {
      sentBody = JSON.parse(options.body);
      return reply(200, { choices: [{ message: { content: JSON.stringify({
        scores: { claim: 15, evidence: 14, structure: 13, reasoning: 12, expression: 16 },
        summary: "结论明确",
      }) } }] });
    },
  });
  const result = await provider.analyze([{ role: "user", content: "测试" }], (value) => validateResult("checkin", value));
  assert.equal(sentBody.model, "deepseek-flash");
  assert.deepEqual(sentBody.thinking, { type: "disabled" });
  assert.deepEqual(sentBody.response_format, { type: "json_object" });
  assert.equal(result.total, 70);
});

test("服务端暂时故障后只重试一次", async () => {
  let calls = 0;
  const provider = new DeepSeekProvider({
    apiKey: "test-key",
    fetch: async () => {
      calls += 1;
      return calls === 1 ? reply(503, {}) : reply(200, { choices: [{ message: { content: '{"ok":true}' } }] });
    },
  });
  assert.deepEqual(await provider.analyze([]), { ok: true });
  assert.equal(calls, 2);
});

test("无效 Key 不重试且不回显 Key", async () => {
  let calls = 0;
  const provider = new DeepSeekProvider({ apiKey: "secret-test-key", fetch: async () => { calls += 1; return reply(401, {}); } });
  await assert.rejects(provider.analyze([]), (error) => error.statusCode === 401 && !error.message.includes("secret-test-key"));
  assert.equal(calls, 1);
});

test("不完整评分会重试，仍失败时返回格式错误", async () => {
  let calls = 0;
  const provider = new DeepSeekProvider({
    apiKey: "test-key",
    fetch: async () => { calls += 1; return reply(200, { choices: [{ message: { content: '{"scores":{"claim":20}}' } }] }); },
  });
  await assert.rejects(provider.analyze([], (value) => validateResult("checkin", value)), (error) => error.statusCode === 502);
  assert.equal(calls, 2);
});

test("网络故障返回可理解的错误", async () => {
  let calls = 0;
  const provider = new DeepSeekProvider({
    apiKey: "test-key",
    fetch: async () => { calls += 1; throw new TypeError("fetch failed"); },
  });
  await assert.rejects(provider.analyze([]), (error) => error.statusCode === 503 && error.message.includes("网络或代理"));
  assert.equal(calls, 2);
});

test("用户取消请求后不再重试", async () => {
  const controller = new AbortController();
  let calls = 0;
  const provider = new DeepSeekProvider({
    apiKey: "test-key",
    fetch: async (_url, options) => {
      calls += 1;
      return new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true }));
    },
  });
  const pending = provider.analyze([], undefined, controller.signal);
  controller.abort();
  await assert.rejects(pending, (error) => error.statusCode === 499);
  assert.equal(calls, 1);
});

test("评分响应包含模型、Prompt 和量表版本", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => reply(200, { choices: [{ message: { content: JSON.stringify({
    scores: { claim: 12, evidence: 12, structure: 12, reasoning: 12, expression: 12 },
    summary: "结构完整",
  }) } }] });
  try {
    const result = await runAiTask({ type: "checkin", payload: { question: "测试", answer: "测试作答" }, apiKey: "test-key" });
    assert.equal(result.total, 60);
    assert.deepEqual(result.meta, { provider: "deepseek", model: "deepseek-flash", promptVersion: "1.1.0", rubricVersion: "1.0.0" });
  } finally {
    global.fetch = originalFetch;
  }
});
