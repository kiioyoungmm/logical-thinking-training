const STORAGE_KEY = "logical-training-data-v1";
const SESSION_KEY = "deepseek-api-key";

const questions = [
  {
    category: "观点分析",
    title: "远程办公是否应该成为公司的默认工作方式？",
    context: "请站在公司管理者的角度作答。无需追求唯一正确答案，重点是让结论、理由与边界条件彼此对应。",
    requirements: ["先用一句话给出明确结论", "提供 2～3 个相互独立的理由", "至少说明一个适用条件或例外情况"],
  },
  {
    category: "方案决策",
    title: "一个进度落后的项目，应该优先增加人手还是缩小范围？",
    context: "项目距离原定发布日期还有两周，核心功能完成约 70%，团队已经连续加班。请提出你的建议。",
    requirements: ["明确选择或给出有条件的选择", "说明判断所依据的关键信息", "指出方案的主要风险"],
  },
  {
    category: "因果辨析",
    title: "某产品降价后销量上涨，能否证明降价是销量增长的原因？",
    context: "请分析这项判断是否充分，并说明还需要了解哪些信息。",
    requirements: ["区分相关关系与因果关系", "提出至少两种其他可能解释", "说明如何进一步验证"],
  },
  {
    category: "结构表达",
    title: "向负责人说明：为什么本周不应该上线新功能？",
    context: "已知测试仍发现严重问题，但业务团队担心延期影响推广计划。请用简洁、可执行的方式表达。",
    requirements: ["结论先行", "理由不超过三点", "给出替代安排或下一步行动"],
  },
  {
    category: "信息判断",
    title: "看到“多数人都推荐”的产品时，你会如何判断它是否适合自己？",
    context: "请给出一套可以实际执行的判断过程，而不是只表达谨慎态度。",
    requirements: ["说明需要核验的信息", "区分大众评价与个人需求", "给出最终决策规则"],
  },
];

const viewMeta = {
  home: ["DAILY PRACTICE", "今天，也把想法理清楚"],
  checkin: ["STRUCTURED EXPRESSION", "今日打卡训练"],
  material: ["TEXT ANALYSIS", "自由材料分析"],
  records: ["PRACTICE HISTORY", "看见每一次思考"],
  profile: ["ABILITY PROFILE", "你的能力档案"],
  settings: ["AI SETTINGS", "模型与隐私设置"],
};

const scoreLabels = {
  claim: "论点",
  evidence: "论据",
  structure: "条理",
  reasoning: "推理",
  expression: "表达",
};

const state = {
  questionIndex: getDailyQuestionIndex(),
  attempt: 1,
  firstAnswer: "",
  firstFeedback: null,
  materialMode: "training",
  serverHasKey: false,
};

const store = loadStore();
let toastTimer;

function $(selector) {
  return document.querySelector(selector);
}

function $all(selector) {
  return [...document.querySelectorAll(selector)];
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function loadStore() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || { records: [] };
  } catch {
    return { records: [] };
  }
}

function saveStore() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}

function getDailyQuestionIndex() {
  const now = new Date();
  const dayNumber = Math.floor(new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() / 86400000);
  return dayNumber % questions.length;
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 2800);
}

function setButtonLoading(button, loading, loadingText = "处理中……") {
  if (loading) {
    button.dataset.originalText = button.textContent;
    button.textContent = loadingText;
    button.disabled = true;
  } else {
    button.textContent = button.dataset.originalText || button.textContent;
    button.disabled = false;
  }
}

function navigate(view) {
  if (!viewMeta[view]) return;
  $all(".view").forEach((item) => item.classList.toggle("active", item.id === `view-${view}`));
  $all("[data-view]").forEach((item) => item.classList.toggle("active", item.dataset.view === view));
  $("#page-eyebrow").textContent = viewMeta[view][0];
  $("#page-title").textContent = viewMeta[view][1];

  if (view === "home") renderHome();
  if (view === "records") renderRecords();
  if (view === "profile") renderProfile();
  if (view === "settings") renderKeyStatus();
  window.scrollTo({ top: 0, behavior: "smooth" });
  history.replaceState(null, "", `#${view}`);
}

function renderQuestion() {
  const question = questions[state.questionIndex];
  $("#question-category").textContent = question.category;
  $("#question-number").textContent = `题目 ${state.questionIndex + 1} / ${questions.length}`;
  $("#question-title").textContent = question.title;
  $("#question-context").textContent = question.context;
  $("#question-requirements").innerHTML = question.requirements.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
}

function resetCheckin() {
  state.attempt = 1;
  state.firstAnswer = "";
  state.firstFeedback = null;
  $("#answer-title").textContent = "第一次作答";
  $("#answer-step").textContent = "1 / 2";
  $("#checkin-answer").value = "";
  $("#checkin-count").textContent = "0";
  $("#checkin-feedback").classList.add("hidden");
  $("#submit-checkin").textContent = "提交并获取反馈";
}

async function callAi(type, payload) {
  const apiKey = sessionStorage.getItem(SESSION_KEY) || "";
  const response = await fetch("/api/ai", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(apiKey ? { "X-DeepSeek-Key": apiKey } : {}),
    },
    body: JSON.stringify({ type, payload }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "AI 请求失败");
  return data;
}

function hasAiKey() {
  return Boolean(sessionStorage.getItem(SESSION_KEY) || state.serverHasKey);
}

function createLocalFeedback(answer, previousAnswer = "") {
  const length = answer.replace(/\s/g, "").length;
  const paragraphs = answer.split(/\n+/).filter((item) => item.trim()).length;
  const evidenceWords = (answer.match(/因为|理由|首先|其次|此外|一是|二是|例如|数据|事实/g) || []).length;
  const reasoningWords = (answer.match(/因此|所以|意味着|导致|如果|那么|但是|然而|前提|除非/g) || []).length;
  const hasConclusion = /^(我认为|结论|建议|应该|不应该|可以|不建议|我的判断)/.test(answer.trim());

  const scores = {
    claim: Math.min(20, 10 + (hasConclusion ? 7 : 2) + (length > 60 ? 2 : 0)),
    evidence: Math.min(20, 8 + evidenceWords * 2 + (length > 180 ? 2 : 0)),
    structure: Math.min(20, 9 + Math.min(6, paragraphs * 2) + (/1[.、]|①|第一/.test(answer) ? 3 : 0)),
    reasoning: Math.min(20, 8 + reasoningWords * 2),
    expression: Math.min(20, 10 + (length >= 80 && length <= 700 ? 5 : 1) + (paragraphs > 1 ? 2 : 0)),
  };
  const total = Object.values(scores).reduce((sum, score) => sum + score, 0);
  const lowestKey = Object.keys(scores).sort((a, b) => scores[a] - scores[b])[0];
  const issues = [];
  if (!hasConclusion) issues.push({ type: "结论不够前置", quote: answer.slice(0, 36), explanation: "开头没有直接表明判断，读者需要自己寻找你的立场。" });
  if (evidenceWords < 2) issues.push({ type: "论据不够显性", quote: "", explanation: "理由与结论之间的边界不清晰，可以用编号列出关键依据。" });
  if (reasoningWords < 1) issues.push({ type: "推理链缺失", quote: "", explanation: "已经表达了观点，但还需要解释理由为什么能够支持结论。" });

  return {
    total,
    scores,
    summary: total >= 78 ? "整体结构已经清楚，下一步可以增强证据和边界条件。" : "观点基本可见，但论点、论据和推理之间还可以连接得更紧。",
    strengths: [hasConclusion ? "能够较快给出自己的判断。" : "已经围绕题目给出了有效信息。", paragraphs > 1 ? "主动进行了分段，阅读负担较低。" : "表达比较集中，没有明显偏题。"],
    issues: issues.slice(0, 3),
    suggestions: [
      `优先改善“${scoreLabels[lowestKey]}”：改写时只集中解决这一项。`,
      "用一句话写结论，再用 2～3 条编号理由支撑。",
      "每个理由后补一句“这为什么能支持我的结论”。",
    ],
    rewriteTask: `改写时重点提升“${scoreLabels[lowestKey]}”，保留核心意思，但让读者更容易跟上。`,
    comparison: previousAnswer ? (answer.length > previousAnswer.length ? "第二次作答补充了更多解释，请继续检查新增内容是否都在支持结论。" : "第二次作答更加精简，请确认关键论据没有随之丢失。") : "",
    local: true,
  };
}

function normalizeFeedback(data) {
  const scores = {};
  Object.keys(scoreLabels).forEach((key) => {
    scores[key] = Math.max(0, Math.min(20, Number(data?.scores?.[key]) || 0));
  });
  return {
    ...data,
    scores,
    total: Object.values(scores).reduce((sum, value) => sum + value, 0),
    strengths: Array.isArray(data.strengths) ? data.strengths : [],
    issues: Array.isArray(data.issues) ? data.issues : [],
    suggestions: Array.isArray(data.suggestions) ? data.suggestions : [],
  };
}

function renderCheckinFeedback(rawFeedback) {
  const feedback = normalizeFeedback(rawFeedback);
  const panel = $("#checkin-feedback");
  const scoreItems = Object.entries(scoreLabels).map(([key, label]) => `
    <div class="score-item"><span>${label}</span><strong>${feedback.scores[key]}</strong></div>
  `).join("");
  const strengths = feedback.strengths.map((item) => `<li>${escapeHtml(item)}</li>`).join("") || "<li>本次暂无明确优势项。</li>";
  const issues = feedback.issues.map((item) => `
    <div class="issue-card"><strong>${escapeHtml(item.type || "需要留意")}</strong>${item.quote ? `<em>“${escapeHtml(item.quote)}”</em>` : ""}<span>${escapeHtml(item.explanation || "")}</span></div>
  `).join("") || "<p>暂未发现明显结构问题。</p>";
  const suggestions = feedback.suggestions.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
  const actionText = state.attempt === 1 ? "根据反馈再写一次" : "完成训练，查看记录";

  panel.innerHTML = `
    <div class="score-head">
      <div class="score-ring"><strong>${feedback.total}</strong></div>
      <div><h2>${state.attempt === 1 ? "第一次反馈" : "改写反馈"}</h2><p>${escapeHtml(feedback.summary || "已完成本次分析。")}${feedback.local ? "（本地基础评估）" : ""}</p></div>
    </div>
    <div class="score-grid">${scoreItems}</div>
    ${feedback.comparison ? `<div class="analysis-block wide"><h3>前后对比</h3><p>${escapeHtml(feedback.comparison)}</p></div>` : ""}
    <div class="feedback-columns">
      <div class="feedback-block"><h3>做得不错</h3><ul>${strengths}</ul></div>
      <div class="feedback-block"><h3>主要问题</h3>${issues}</div>
      <div class="feedback-block"><h3>改进建议</h3><ul>${suggestions}</ul></div>
      <div class="feedback-block"><h3>本轮训练重点</h3><p>${escapeHtml(feedback.rewriteTask || "根据上面的建议完成一次改写。")}</p></div>
    </div>
    <div class="rewrite-box"><div><strong>${state.attempt === 1 ? "不要追求完美，只解决一个主要问题" : "训练已完成"}</strong><p>${state.attempt === 1 ? escapeHtml(feedback.rewriteTask || "") : "记录已保存，可以回看本次变化。"}</p></div><button class="primary-button" id="feedback-action">${actionText}</button></div>
  `;
  panel.classList.remove("hidden");
  panel.scrollIntoView({ behavior: "smooth", block: "start" });

  $("#feedback-action").addEventListener("click", () => {
    if (state.attempt === 1) startRewrite(feedback);
    else navigate("records");
  });
  return feedback;
}

function startRewrite(feedback) {
  state.firstAnswer = $("#checkin-answer").value.trim();
  state.firstFeedback = feedback;
  state.attempt = 2;
  $("#answer-title").textContent = "第二次作答";
  $("#answer-step").textContent = "2 / 2";
  $("#checkin-answer").value = state.firstAnswer;
  $("#checkin-count").textContent = String(state.firstAnswer.length);
  $("#submit-checkin").textContent = "提交改写并完成训练";
  $("#checkin-feedback").classList.add("hidden");
  $("#checkin-answer").focus();
  $(".answer-card").scrollIntoView({ behavior: "smooth", block: "start" });
  showToast("请根据反馈修改原文，再提交一次");
}

async function submitCheckin() {
  const answer = $("#checkin-answer").value.trim();
  if (answer.length < 30) return showToast("至少写 30 个字，才能进行有效分析");
  if (state.attempt === 2 && answer === state.firstAnswer) return showToast("请先根据反馈修改内容，再提交第二次作答");

  const button = $("#submit-checkin");
  setButtonLoading(button, true, "正在分析……");
  let feedback;
  try {
    if (!hasAiKey()) throw new Error("未配置 API Key");
    feedback = await callAi("checkin", {
      question: questions[state.questionIndex].title,
      answer,
      previousAnswer: state.attempt === 2 ? state.firstAnswer : "",
      previousFeedback: state.attempt === 2 ? state.firstFeedback : null,
    });
  } catch (error) {
    feedback = createLocalFeedback(answer, state.attempt === 2 ? state.firstAnswer : "");
    showToast(`${error.message}，已改用本地基础评估`);
  } finally {
    setButtonLoading(button, false);
  }

  const normalized = renderCheckinFeedback(feedback);
  if (state.attempt === 2) {
    addRecord({
      type: "checkin",
      title: questions[state.questionIndex].title,
      score: normalized.total,
      scores: normalized.scores,
      summary: normalized.summary,
    });
  }
}

function createLocalMaterialAnalysis(material, userClaim) {
  const sentences = material.split(/[。！？\n]+/).map((item) => item.trim()).filter(Boolean);
  const factHints = /数据|调查|报告|显示|发生|达到|增长|下降|年|月|日|%|％|个|人/;
  const opinionHints = /认为|应该|最好|显然|一定|值得|重要|糟糕|优秀|可能/;
  const facts = sentences.filter((item) => factHints.test(item)).slice(0, 4);
  const opinions = sentences.filter((item) => opinionHints.test(item)).slice(0, 4);
  const claim = userClaim || opinions[0] || sentences.at(-1) || "材料过短，暂时无法提取核心结论。";
  return {
    topic: sentences[0]?.slice(0, 50) || "未识别",
    claim,
    structure: sentences.slice(0, 5).map((content, index) => ({ type: index === 0 ? "背景/引入" : (content === claim ? "核心论点" : "相关信息"), content, relation: index === 0 ? "引出讨论" : "可能支持或补充核心观点" })),
    facts,
    opinions,
    assumptions: ["材料可能默认读者接受其评价标准，但没有完整说明这一标准。"],
    fallacies: [],
    missing: ["需要核验材料中的事实来源与样本范围。", "需要寻找能够推翻核心结论的反例。"],
    feedback: userClaim ? "你的拆解抓住了一个可能的结论。下一步请逐条检查：每个论据是否真的支持它，而不只是与主题相关。" : "当前为基础文本拆解；配置 DeepSeek 后可以获得更细致的语义与谬误分析。",
    nextQuestion: "如果核心结论相反，什么证据最有可能支持它？",
    local: true,
  };
}

function renderMaterialResult(result) {
  const list = (items, empty = "未识别到明确内容") => Array.isArray(items) && items.length ? `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : `<p>${empty}</p>`;
  const structure = Array.isArray(result.structure) ? result.structure.map((item) => `<li><strong>${escapeHtml(item.type)}</strong>：${escapeHtml(item.content)}<br><small>${escapeHtml(item.relation || "")}</small></li>`).join("") : "";
  const fallacies = Array.isArray(result.fallacies) && result.fallacies.length ? result.fallacies.map((item) => `<div class="issue-card"><strong>${escapeHtml(item.name)} · ${escapeHtml(item.confidence || "")}</strong><span>${escapeHtml(item.explanation || "")}</span></div>`).join("") : "<p>未识别到高置信度逻辑谬误，不代表论证已经充分。</p>";

  const panel = $("#material-result");
  panel.innerHTML = `
    <div class="score-head"><div><p class="eyebrow">ANALYSIS RESULT</p><h2>材料逻辑结构</h2><p>${result.local ? "当前使用本地基础拆解。配置 DeepSeek 后可获得深度语义分析。" : "AI 已完成材料拆解，请重点核对它的判断，而不是直接接受。"}</p></div></div>
    <div class="analysis-grid">
      <div class="analysis-block"><h3>核心问题</h3><p>${escapeHtml(result.topic || "未识别")}</p></div>
      <div class="analysis-block"><h3>核心结论</h3><p>${escapeHtml(result.claim || "未识别")}</p></div>
      <div class="analysis-block wide"><h3>结构拆解</h3><ul>${structure || "<li>未识别到清晰结构</li>"}</ul></div>
      <div class="analysis-block"><h3>事实</h3>${list(result.facts)}</div>
      <div class="analysis-block"><h3>观点</h3>${list(result.opinions)}</div>
      <div class="analysis-block"><h3>隐含前提</h3>${list(result.assumptions)}</div>
      <div class="analysis-block"><h3>缺失证据 / 反例</h3>${list(result.missing)}</div>
      <div class="analysis-block wide"><h3>可能的逻辑薄弱点</h3>${fallacies}</div>
      <div class="analysis-block wide"><h3>训练反馈</h3><p>${escapeHtml(result.feedback || "")}</p></div>
      <div class="analysis-block wide"><h3>继续思考</h3><p>${escapeHtml(result.nextQuestion || "")}</p></div>
    </div>
  `;
  panel.classList.remove("hidden");
  panel.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function analyzeMaterial() {
  const material = $("#material-input").value.trim();
  const userClaim = $("#user-claim").value.trim();
  const userEvidence = $("#user-evidence").value.trim();
  if (material.length < 50) return showToast("请至少输入 50 个字的材料");
  if (state.materialMode === "training" && !userClaim) return showToast("训练模式下，请先写出你认为的核心结论");

  const button = $("#analyze-material");
  setButtonLoading(button, true, "正在拆解……");
  let result;
  try {
    if (!hasAiKey()) throw new Error("未配置 API Key");
    result = await callAi("material", { material, mode: state.materialMode, userClaim, userEvidence });
  } catch (error) {
    result = createLocalMaterialAnalysis(material, userClaim);
    showToast(`${error.message}，已改用本地基础拆解`);
  } finally {
    setButtonLoading(button, false);
  }
  renderMaterialResult(result);
  addRecord({ type: "material", title: result.topic || material.slice(0, 36), summary: result.feedback || "已完成材料分析" });
}

function addRecord(record) {
  store.records.unshift({ id: Date.now(), createdAt: new Date().toISOString(), ...record });
  store.records = store.records.slice(0, 100);
  saveStore();
  renderHome();
}

function getStreak() {
  const toLocalDateKey = (value) => {
    const date = new Date(value);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };
  const days = [...new Set(store.records.map((item) => toLocalDateKey(item.createdAt)))].sort().reverse();
  if (!days.length) return 0;
  let cursor = new Date();
  const today = toLocalDateKey(cursor);
  if (days[0] !== today) {
    cursor.setDate(cursor.getDate() - 1);
    if (days[0] !== toLocalDateKey(cursor)) return 0;
  }
  let streak = 0;
  for (const day of days) {
    if (day !== toLocalDateKey(cursor)) break;
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

function getAbilityAverages() {
  const scored = store.records.filter((item) => item.type === "checkin" && item.scores);
  const result = Object.fromEntries(Object.keys(scoreLabels).map((key) => [key, 0]));
  if (!scored.length) return result;
  scored.forEach((record) => Object.keys(result).forEach((key) => { result[key] += Number(record.scores[key]) || 0; }));
  Object.keys(result).forEach((key) => { result[key] = Math.round(result[key] / scored.length); });
  return result;
}

function renderHome() {
  const averages = getAbilityAverages();
  const weakest = Object.keys(averages).sort((a, b) => averages[a] - averages[b])[0];
  $("#home-streak").innerHTML = `${getStreak()}<small> 天</small>`;
  $("#home-total").innerHTML = `${store.records.length}<small> 次</small>`;
  $("#home-focus").textContent = store.records.some((item) => item.scores) ? `提升${scoreLabels[weakest]}能力` : "建立训练基线";
}

function renderRecords() {
  const list = $("#record-list");
  if (!store.records.length) {
    list.innerHTML = '<div class="empty-state"><strong>还没有训练记录</strong>完成一次打卡或材料分析后，记录会出现在这里。</div>';
    return;
  }
  list.innerHTML = store.records.map((record) => {
    const date = new Date(record.createdAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
    return `<article class="record-card"><time>${escapeHtml(date)}</time><div><h3>${escapeHtml(record.title)}</h3><p>${escapeHtml(record.summary || "已完成训练")}</p></div><span class="record-score">${record.score ?? (record.type === "material" ? "分析" : "—")}</span></article>`;
  }).join("");
}

function renderProfile() {
  const averages = getAbilityAverages();
  const hasScores = store.records.some((item) => item.scores);
  $("#ability-bars").innerHTML = Object.entries(scoreLabels).map(([key, label]) => `<div class="ability-row"><span>${label}</span><div class="bar-track"><i style="width:${averages[key] * 5}%"></i></div><strong>${averages[key]}</strong></div>`).join("");
  if (!hasScores) {
    $("#profile-focus").textContent = "先完成第一次训练";
    $("#profile-advice").textContent = "完成两轮作答后，五项能力得分会沉淀在这里。";
    return;
  }
  const weakest = Object.keys(averages).sort((a, b) => averages[a] - averages[b])[0];
  $("#profile-focus").textContent = `下一阶段：${scoreLabels[weakest]}`;
  $("#profile-advice").textContent = `当前“${scoreLabels[weakest]}”平均得分最低。接下来三次训练优先改善这一项，不必同时解决所有问题。`;
}

function renderKeyStatus() {
  const ready = hasAiKey();
  const status = $("#key-status");
  status.textContent = ready ? (sessionStorage.getItem(SESSION_KEY) ? "会话中已配置" : "服务器已配置") : "未配置";
  status.classList.toggle("ready", ready);
  $("#api-key").value = sessionStorage.getItem(SESSION_KEY) || "";
}

function bindEvents() {
  $all("[data-view]").forEach((button) => button.addEventListener("click", () => navigate(button.dataset.view)));
  $("#change-question").addEventListener("click", () => {
    state.questionIndex = (state.questionIndex + 1) % questions.length;
    resetCheckin();
    renderQuestion();
  });
  $("#checkin-answer").addEventListener("input", (event) => { $("#checkin-count").textContent = event.target.value.length; });
  $("#material-input").addEventListener("input", (event) => { $("#material-count").textContent = event.target.value.length; });
  $("#submit-checkin").addEventListener("click", submitCheckin);
  $("#analyze-material").addEventListener("click", analyzeMaterial);

  $all("[data-mode]").forEach((button) => button.addEventListener("click", () => {
    state.materialMode = button.dataset.mode;
    $all("[data-mode]").forEach((item) => item.classList.toggle("active", item === button));
    $("#training-fields").classList.toggle("hidden", state.materialMode === "direct");
    $("#material-result").classList.add("hidden");
  }));

  $("#save-key").addEventListener("click", () => {
    const key = $("#api-key").value.trim();
    if (!key) return showToast("请输入 DeepSeek API Key");
    sessionStorage.setItem(SESSION_KEY, key);
    renderKeyStatus();
    showToast("API Key 已保存到当前浏览器会话");
  });
  $("#clear-key").addEventListener("click", () => {
    sessionStorage.removeItem(SESSION_KEY);
    $("#api-key").value = "";
    renderKeyStatus();
    showToast("当前会话中的 API Key 已清除");
  });
  $("#toggle-key").addEventListener("click", () => {
    const input = $("#api-key");
    input.type = input.type === "password" ? "text" : "password";
    $("#toggle-key").textContent = input.type === "password" ? "显示" : "隐藏";
  });
  $("#clear-records").addEventListener("click", () => {
    if (!store.records.length) return showToast("当前没有训练记录");
    if (!window.confirm("确定清空全部训练记录吗？此操作无法恢复。")) return;
    store.records = [];
    saveStore();
    renderRecords();
    renderHome();
    showToast("训练记录已清空");
  });
}

async function init() {
  bindEvents();
  renderQuestion();
  renderHome();
  try {
    const response = await fetch("/api/health");
    const data = await response.json();
    state.serverHasKey = Boolean(data.envKeyConfigured);
  } catch {
    state.serverHasKey = false;
  }
  const initialView = location.hash.slice(1);
  navigate(viewMeta[initialView] ? initialView : "home");
}

init();
