const DeepSeekProvider = require("./providers/deepseek");
const { buildCheckinPrompt, CHECKIN_PROMPT_VERSION, SCORE_RUBRIC_VERSION } = require("./skills/checkin");
const { buildMaterialPrompt, MATERIAL_PROMPT_VERSION } = require("./skills/material");

const promptBuilders = {
  checkin: buildCheckinPrompt,
  material: buildMaterialPrompt,
};

function validateResult(type, result) {
  if (!result || typeof result !== "object") throwInvalidResult();
  if (type === "checkin") {
    const keys = ["claim", "evidence", "structure", "reasoning", "expression"];
    const scores = result.scores;
    if (!scores || keys.some((key) => !Number.isFinite(Number(scores[key])) || Number(scores[key]) < 0 || Number(scores[key]) > 20) || typeof result.summary !== "string") throwInvalidResult();
    result.scores = Object.fromEntries(keys.map((key) => [key, Number(scores[key])]));
    result.total = Object.values(result.scores).reduce((sum, value) => sum + value, 0);
    result.strengths = Array.isArray(result.strengths) ? result.strengths : [];
    result.issues = Array.isArray(result.issues) ? result.issues : [];
    result.suggestions = Array.isArray(result.suggestions) ? result.suggestions : [];
  } else if (typeof result.claim !== "string" || !Array.isArray(result.structure)) {
    throwInvalidResult();
  }
  return result;
}

function throwInvalidResult() {
  const error = new Error("DeepSeek 返回内容不完整，请重试");
  error.statusCode = 502;
  error.retryable = true;
  throw error;
}

async function runAiTask({ type, payload, apiKey, signal }) {
  const buildPrompt = promptBuilders[type];
  if (!buildPrompt) {
    const error = new Error("不支持的训练类型");
    error.statusCode = 400;
    throw error;
  }

  // 当前只接入 DeepSeek，后续可在这里按配置创建其他 Provider。
  const provider = new DeepSeekProvider({
    apiKey: apiKey || process.env.DEEPSEEK_API_KEY,
  });
  const result = await provider.analyze(buildPrompt(payload), (value) => validateResult(type, value), signal);
  return {
    ...result,
    meta: {
      provider: "deepseek",
      model: provider.model,
      promptVersion: type === "checkin" ? CHECKIN_PROMPT_VERSION : MATERIAL_PROMPT_VERSION,
      ...(type === "checkin" ? { rubricVersion: SCORE_RUBRIC_VERSION } : {}),
    },
  };
}

module.exports = { runAiTask, validateResult };
