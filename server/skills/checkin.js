const SCORE_RULES = `
评分维度（每项 0-20 分）：
1. 论点：结论是否明确、聚焦问题；
2. 论据：理由是否充分、具体、可验证；
3. 条理：层次是否清楚，信息是否有序；
4. 推理：论据能否支持结论，是否存在跳跃；
5. 表达：语言是否简洁、准确、易懂。
`;

function buildCheckinPrompt(payload) {
  const isRewrite = Boolean(payload.previousAnswer);
  const userContent = [
    `训练题目：${payload.question}`,
    `用户作答：${payload.answer}`,
    isRewrite ? `第一次作答：${payload.previousAnswer}` : "",
    isRewrite ? `第一次反馈：${JSON.stringify(payload.previousFeedback || {})}` : "",
  ].filter(Boolean).join("\n\n");

  return [
    {
      role: "system",
      content: `你是一名严格但友善的逻辑思维与结构化表达教练。重点是帮助用户发现具体问题并完成下一次改写，不要代替用户思考。
${SCORE_RULES}
只返回 JSON，格式为：
{
  "total": 0,
  "scores": {"claim":0,"evidence":0,"structure":0,"reasoning":0,"expression":0},
  "summary": "一句话总体评价",
  "strengths": ["最多两点"],
  "issues": [{"type":"问题类型","quote":"对应原文","explanation":"为什么是问题"}],
  "suggestions": ["最多三条、可以立即执行的建议"],
  "rewriteTask": "下一次改写只需重点完成的一件事",
  "comparison": "若为第二次作答，说明进步与仍需改进之处，否则为空字符串"
}
总分必须等于五个维度之和。不要输出参考答案。`,
    },
    { role: "user", content: userContent },
  ];
}

module.exports = { buildCheckinPrompt };
