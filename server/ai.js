const DeepSeekProvider = require("./providers/deepseek");
const { buildCheckinPrompt, buildVariantPrompt, CHECKIN_PROMPT_VERSION, VARIANT_PROMPT_VERSION, SCORE_RUBRIC_VERSION, ISSUE_TAGS } = require("./skills/checkin");
const { buildMaterialPrompt, MATERIAL_PROMPT_VERSION } = require("./skills/material");
const { loadQuestions } = require("./question-bank");

const questions = loadQuestions();
const questionsById = new Map(questions.map((question) => [question.id, question]));

const promptBuilders = {
  checkin: buildCheckinPrompt,
  material: buildMaterialPrompt,
};

function validateResult(type, result) {
  if (!result || typeof result !== "object") throwInvalidResult();
  if (type === "variant") {
    if (typeof result.title !== "string" || result.title.length < 8 || result.title.length > 100 || typeof result.context !== "string" || result.context.length < 80 || result.context.length > 400 || !Array.isArray(result.requirements) || result.requirements.length < 2 || result.requirements.length > 4 || result.requirements.some((item) => typeof item !== "string" || !item.trim() || item.length > 100) || typeof result.focus !== "string" || result.focus.length < 8 || result.focus.length > 120) throwInvalidResult();
  } else if (type === "checkin") {
    const keys = ["claim", "evidence", "structure", "reasoning", "expression"];
    const scores = result.scores;
    if (!scores || keys.some((key) => !Number.isFinite(Number(scores[key])) || Number(scores[key]) < 0 || Number(scores[key]) > 20) || typeof result.summary !== "string") throwInvalidResult();
    result.scores = Object.fromEntries(keys.map((key) => [key, Number(scores[key])]));
    result.total = Object.values(result.scores).reduce((sum, value) => sum + value, 0);
    result.strengths = Array.isArray(result.strengths) ? result.strengths : [];
    result.issues = Array.isArray(result.issues) ? result.issues : [];
    if (result.issues.some((issue) => !issue || typeof issue !== "object" || (issue.quote !== undefined && typeof issue.quote !== "string"))) throwInvalidResult();
    result.issues.forEach((issue) => { issue.tag = ISSUE_TAGS.includes(issue.tag) ? issue.tag : ""; });
    result.suggestions = Array.isArray(result.suggestions) ? result.suggestions : [];
  } else if (typeof result.claim !== "string" || !Array.isArray(result.structure)) {
    throwInvalidResult();
  }
  return result;
}

function getBaseQuestion(id) {
  const question = questionsById.get(id);
  if (!question) {
    const error = new Error("题目不存在，请刷新题库");
    error.statusCode = 400;
    throw error;
  }
  return question;
}

function throwInvalidResult() {
  const error = new Error("DeepSeek 返回内容不完整，请重试");
  error.statusCode = 502;
  error.retryable = true;
  throw error;
}

async function runAiTask({ type, payload, apiKey, signal }) {
  if (!promptBuilders[type] && type !== "variant") {
    const error = new Error("不支持的训练类型");
    error.statusCode = 400;
    throw error;
  }

  // 当前只接入 DeepSeek，后续可在这里按配置创建其他 Provider。
  const provider = new DeepSeekProvider({
    apiKey: apiKey || process.env.DEEPSEEK_API_KEY,
  });
  let question;
  if (type === "variant") question = getBaseQuestion(payload.questionId);
  if (type === "checkin") {
    if (payload.question?.sourceId) {
      const base = getBaseQuestion(payload.question.sourceId);
      const variant = validateResult("variant", payload.question);
      question = { ...base, title: variant.title, context: variant.context, requirements: variant.requirements, focus: variant.focus };
    } else question = payload.questionId ? getBaseQuestion(payload.questionId) : { title: payload.question || "未提供题目" };
  }
  const prompt = type === "variant" ? buildVariantPrompt(question) : promptBuilders[type](type === "checkin" ? { ...payload, question } : payload);
  const result = await provider.analyze(prompt, (value) => {
    const validated = validateResult(type, value);
    if (type === "variant" && validated.context.trim() === question.context.trim()) throwInvalidResult();
    if (type === "checkin" && validated.issues.some((issue) => issue.quote && !String(payload.answer || "").includes(String(issue.quote).trim()))) throwInvalidResult();
    return validated;
  }, signal);
  return {
    ...result,
    ...(type === "variant" ? { sourceId: question.id, category: question.category, difficulty: question.difficulty, skills: question.skills } : {}),
    meta: {
      provider: "deepseek",
      model: provider.model,
      promptVersion: type === "material" ? MATERIAL_PROMPT_VERSION : type === "variant" ? VARIANT_PROMPT_VERSION : CHECKIN_PROMPT_VERSION,
      ...(type === "checkin" ? { rubricVersion: SCORE_RUBRIC_VERSION } : {}),
    },
  };
}

module.exports = { runAiTask, validateResult };
