const fs = require("fs");
const path = require("path");

const BANK_FILE = path.join(__dirname, "..", "data", "questions.json");
const CATEGORIES = ["提炼结论", "论据组织", "因果分析", "方案决策", "反例与边界", "结构化表达"];
const SKILLS = ["claim", "evidence", "structure", "reasoning", "expression"];

function validateQuestions(questions) {
  if (!Array.isArray(questions) || !questions.length) throw new Error("题库必须是非空数组");
  const ids = new Set();
  for (const question of questions) {
    if (!question || typeof question.id !== "string" || !/^[A-Z]{2}\d{2}$/.test(question.id) || ids.has(question.id)) throw new Error("题目 ID 无效或重复");
    ids.add(question.id);
    if (!CATEGORIES.includes(question.category) || ![1, 2, 3].includes(question.difficulty)) throw new Error(`${question.id} 的分类或难度无效`);
    if (!Array.isArray(question.skills) || !question.skills.length || question.skills.some((skill) => !SKILLS.includes(skill))) throw new Error(`${question.id} 的训练能力无效`);
    if (typeof question.title !== "string" || question.title.length < 8 || typeof question.context !== "string" || question.context.length < 80) throw new Error(`${question.id} 的题干或材料过短`);
    if (!Array.isArray(question.requirements) || question.requirements.length < 2 || question.requirements.some((item) => typeof item !== "string" || !item.trim())) throw new Error(`${question.id} 缺少作答要求`);
    if (typeof question.focus !== "string" || question.focus.length < 8) throw new Error(`${question.id} 缺少评分重点`);
  }
  return questions;
}

function loadQuestions(file = BANK_FILE) {
  return validateQuestions(JSON.parse(fs.readFileSync(file, "utf8")));
}

function mergeQuestions(existing, incoming) {
  validateQuestions(existing);
  validateQuestions(incoming);
  const ids = new Set(existing.map((item) => item.id));
  if (incoming.some((item) => ids.has(item.id))) throw new Error("导入文件包含已有题目 ID，请先修改 ID");
  return validateQuestions([...existing, ...incoming]);
}

module.exports = { BANK_FILE, CATEGORIES, loadQuestions, mergeQuestions, validateQuestions };
