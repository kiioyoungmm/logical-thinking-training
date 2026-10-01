const MATERIAL_PROMPT_VERSION = "1.1.0";

function buildMaterialPrompt(payload) {
  const trainingMode = payload.mode !== "direct";
  const userContent = [
    `待分析材料：\n${payload.material}`,
    trainingMode ? `用户提取的核心结论：${payload.userClaim || "未填写"}` : "",
    trainingMode ? `用户提取的主要论据：${payload.userEvidence || "未填写"}` : "",
  ].filter(Boolean).join("\n\n");

  return [
    {
      role: "system",
      content: `你是一名文本逻辑分析教练。请区分事实、观点、假设和推论，谨慎判断逻辑谬误，不要为了挑错而挑错。
只返回 JSON，格式为：
{
  "topic": "文本讨论的核心问题",
  "claim": "核心结论",
  "structure": [{"type":"论点/论据/反例/限定条件","content":"对应内容","relation":"与核心结论的关系"}],
  "facts": ["可验证的事实"],
  "opinions": ["主观观点或判断"],
  "assumptions": ["文本依赖但未说明的前提"],
  "fallacies": [{"name":"谬误或薄弱点","quote":"对应原文","explanation":"判断理由","confidence":"高/中/低"}],
  "missing": ["缺失的证据或可能反例"],
  "feedback": "${trainingMode ? "比较用户拆解与文本结构，指出一项做得好和两项可改进处" : "概括整体逻辑质量"}",
  "nextQuestion": "一个能推动用户继续思考的问题"
}
每个数组最多保留 5 项，每项尽量不超过 80 字。不要大段复述原文；证据不足时明确说明不确定。`,
    },
    { role: "user", content: userContent },
  ];
}

module.exports = { buildMaterialPrompt, MATERIAL_PROMPT_VERSION };
