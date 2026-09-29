const DeepSeekProvider = require("./providers/deepseek");
const { buildCheckinPrompt } = require("./skills/checkin");
const { buildMaterialPrompt } = require("./skills/material");

const promptBuilders = {
  checkin: buildCheckinPrompt,
  material: buildMaterialPrompt,
};

async function runAiTask({ type, payload, apiKey }) {
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
  return provider.analyze(buildPrompt(payload));
}

module.exports = { runAiTask };
