const fs = require("fs");
const path = require("path");
const { BANK_FILE, loadQuestions, mergeQuestions } = require("../server/question-bank");

const source = process.argv[2];
if (!source) {
  console.error("用法：npm run import:questions -- 新题目.json");
  process.exitCode = 1;
} else {
  try {
    const incoming = loadQuestions(path.resolve(source));
    const merged = mergeQuestions(loadQuestions(), incoming);
    fs.writeFileSync(BANK_FILE, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
    console.log(`已导入 ${incoming.length} 道题，题库现有 ${merged.length} 道。请重启服务。`);
  } catch (error) {
    console.error(`导入失败：${error.message}`);
    process.exitCode = 1;
  }
}
