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
  serverHasKey: null,
  completedRecordId: null,
  materialRecordId: null,
};

const store = loadStore();
let toastTimer;
const activeRequests = { checkin: null, material: null };

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
  state.completedRecordId = null;
  $("#answer-title").textContent = "第一次作答";
  $("#answer-step").textContent = "1 / 2";
  $("#checkin-answer").value = "";
  $("#checkin-count").textContent = "0";
  $("#checkin-feedback").classList.add("hidden");
  $("#submit-checkin").textContent = "提交并获取反馈";
}

async function callAi(type, payload, signal) {
  const apiKey = sessionStorage.getItem(SESSION_KEY) || "";
  const response = await fetch("/api/ai", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(apiKey ? { "X-DeepSeek-Key": apiKey } : {}),
    },
    body: JSON.stringify({ type, payload }),
    signal,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "AI 请求失败");
  // 健康检查偶尔可能被浏览器拦截；实际调用成功即可确认服务端可用。
  if (!apiKey) state.serverHasKey = true;
  return data;
}

function hasAiKey() {
  return Boolean(sessionStorage.getItem(SESSION_KEY) || state.serverHasKey);
}

function showRequestError(selector, message, retry) {
  const panel = $(selector);
  panel.innerHTML = `<div class="analysis-block"><h3>本次分析未完成</h3><p>${escapeHtml(message)}。没有生成或保存评分。</p><button class="outline-button" id="retry-request">重新生成反馈</button></div>`;
  panel.classList.remove("hidden");
  panel.querySelector("#retry-request").addEventListener("click", retry);
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
      <div><h2>${state.attempt === 1 ? "第一次反馈" : "改写反馈"}</h2><p>${escapeHtml(feedback.summary || "已完成本次分析。")}</p></div>
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
    <button class="text-button" id="regenerate-checkin">重新生成反馈</button>
  `;
  panel.classList.remove("hidden");
  panel.scrollIntoView({ behavior: "smooth", block: "start" });

  $("#feedback-action").addEventListener("click", () => {
    if (state.attempt === 1) startRewrite(feedback);
    else navigate("records");
  });
  $("#regenerate-checkin").addEventListener("click", submitCheckin);
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
  if (activeRequests.checkin) return;
  const answer = $("#checkin-answer").value.trim();
  if (answer.length < 30) return showToast("至少写 30 个字，才能进行有效分析");
  if (state.attempt === 2 && answer === state.firstAnswer) return showToast("请先根据反馈修改内容，再提交第二次作答");

  const button = $("#submit-checkin");
  const controller = new AbortController();
  activeRequests.checkin = controller;
  setButtonLoading(button, true, "正在分析……");
  $("#cancel-checkin").classList.remove("hidden");
  $("#checkin-feedback").classList.add("hidden");
  try {
    const feedback = await callAi("checkin", {
      question: questions[state.questionIndex].title,
      answer,
      previousAnswer: state.attempt === 2 ? state.firstAnswer : "",
      previousFeedback: state.attempt === 2 ? state.firstFeedback : null,
    }, controller.signal);
    const normalized = renderCheckinFeedback(feedback);
    if (state.attempt === 2) {
      const record = {
        type: "checkin",
        title: questions[state.questionIndex].title,
        score: normalized.total,
        scores: normalized.scores,
        summary: normalized.summary,
        meta: feedback.meta,
        firstMeta: state.firstFeedback?.meta,
      };
      if (state.completedRecordId) state.completedRecordId = updateRecord(state.completedRecordId, record);
      else state.completedRecordId = addRecord(record);
    }
  } catch (error) {
    if (controller.signal.aborted) showToast("已取消，本次未保存评分");
    else showRequestError("#checkin-feedback", error.message, submitCheckin);
  } finally {
    activeRequests.checkin = null;
    setButtonLoading(button, false);
    $("#cancel-checkin").classList.add("hidden");
  }
}

function renderMaterialResult(result) {
  const list = (items, empty = "未识别到明确内容") => Array.isArray(items) && items.length ? `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : `<p>${empty}</p>`;
  const structure = Array.isArray(result.structure) ? result.structure.map((item) => `<li><strong>${escapeHtml(item.type)}</strong>：${escapeHtml(item.content)}<br><small>${escapeHtml(item.relation || "")}</small></li>`).join("") : "";
  const fallacies = Array.isArray(result.fallacies) && result.fallacies.length ? result.fallacies.map((item) => `<div class="issue-card"><strong>${escapeHtml(item.name)} · ${escapeHtml(item.confidence || "")}</strong><span>${escapeHtml(item.explanation || "")}</span></div>`).join("") : "<p>未识别到高置信度逻辑谬误，不代表论证已经充分。</p>";

  const panel = $("#material-result");
  panel.innerHTML = `
    <div class="score-head"><div><p class="eyebrow">ANALYSIS RESULT</p><h2>材料逻辑结构</h2><p>AI 已完成材料拆解，请重点核对它的判断，而不是直接接受。</p></div></div>
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
    <button class="text-button" id="regenerate-material">重新生成反馈</button>
  `;
  panel.classList.remove("hidden");
  panel.scrollIntoView({ behavior: "smooth", block: "start" });
  $("#regenerate-material").addEventListener("click", analyzeMaterial);
}

async function analyzeMaterial() {
  if (activeRequests.material) return;
  const material = $("#material-input").value.trim();
  // 直接分析模式不读取隐藏的训练答案，避免旧内容影响分析结果。
  const userClaim = state.materialMode === "training" ? $("#user-claim").value.trim() : "";
  const userEvidence = state.materialMode === "training" ? $("#user-evidence").value.trim() : "";
  if (material.length < 50) return showToast("请至少输入 50 个字的材料");
  if (state.materialMode === "training" && !userClaim) return showToast("训练模式下，请先写出你认为的核心结论");

  const button = $("#analyze-material");
  const controller = new AbortController();
  activeRequests.material = controller;
  setButtonLoading(button, true, "正在拆解……");
  $("#cancel-material").classList.remove("hidden");
  $("#material-result").classList.add("hidden");
  try {
    const result = await callAi("material", { material, mode: state.materialMode, userClaim, userEvidence }, controller.signal);
    renderMaterialResult(result);
    const record = { type: "material", title: result.topic || material.slice(0, 36), summary: result.feedback || "已完成材料分析", meta: result.meta };
    if (state.materialRecordId) state.materialRecordId = updateRecord(state.materialRecordId, record);
    else state.materialRecordId = addRecord(record);
  } catch (error) {
    if (controller.signal.aborted) showToast("已取消，本次未保存分析");
    else showRequestError("#material-result", error.message, analyzeMaterial);
  } finally {
    activeRequests.material = null;
    setButtonLoading(button, false);
    $("#cancel-material").classList.add("hidden");
  }
}

function addRecord(record) {
  const id = Date.now();
  store.records.unshift({ id, createdAt: new Date().toISOString(), ...record });
  store.records = store.records.slice(0, 100);
  saveStore();
  renderHome();
  return id;
}

function updateRecord(id, record) {
  const existing = store.records.find((item) => item.id === id);
  if (!existing) return addRecord(record);
  Object.assign(existing, record);
  saveStore();
  renderHome();
  return id;
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

function hasVerifiedScores(record) {
  return record.type === "checkin" && record.scores && record.meta?.provider === "deepseek";
}

function getAbilityAverages() {
  const scored = store.records.filter(hasVerifiedScores);
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
  $("#home-focus").textContent = store.records.some(hasVerifiedScores) ? `提升${scoreLabels[weakest]}能力` : "建立训练基线";
}

function renderRecords() {
  const list = $("#record-list");
  if (!store.records.length) {
    list.innerHTML = '<div class="empty-state"><strong>还没有训练记录</strong>完成一次打卡或材料分析后，记录会出现在这里。</div>';
    return;
  }
  list.innerHTML = store.records.map((record) => {
    const date = new Date(record.createdAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
    const score = hasVerifiedScores(record) ? record.score : record.type === "material" ? "分析" : "未核验";
    return `<article class="record-card"><time>${escapeHtml(date)}</time><div><h3>${escapeHtml(record.title)}</h3><p>${escapeHtml(record.summary || "已完成训练")}</p></div><span class="record-score">${score}</span></article>`;
  }).join("");
}

function renderProfile() {
  const averages = getAbilityAverages();
  const hasScores = store.records.some(hasVerifiedScores);
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
  status.textContent = ready ? (sessionStorage.getItem(SESSION_KEY) ? "会话中已配置" : "服务器已配置") : state.serverHasKey === null ? "无法检测服务" : "未配置";
  status.classList.toggle("ready", ready);
  $("#api-key").value = sessionStorage.getItem(SESSION_KEY) || "";
}

function bindEvents() {
  $all("[data-view]").forEach((button) => button.addEventListener("click", () => navigate(button.dataset.view)));
  $("#change-question").addEventListener("click", () => {
    activeRequests.checkin?.abort();
    state.questionIndex = (state.questionIndex + 1) % questions.length;
    resetCheckin();
    renderQuestion();
  });
  $("#checkin-answer").addEventListener("input", (event) => { $("#checkin-count").textContent = event.target.value.length; });
  $("#material-input").addEventListener("input", (event) => { $("#material-count").textContent = event.target.value.length; state.materialRecordId = null; });
  $("#user-claim").addEventListener("input", () => { state.materialRecordId = null; });
  $("#user-evidence").addEventListener("input", () => { state.materialRecordId = null; });
  $("#submit-checkin").addEventListener("click", submitCheckin);
  $("#cancel-checkin").addEventListener("click", () => activeRequests.checkin?.abort());
  $("#analyze-material").addEventListener("click", analyzeMaterial);
  $("#cancel-material").addEventListener("click", () => activeRequests.material?.abort());

  $all("[data-mode]").forEach((button) => button.addEventListener("click", () => {
    activeRequests.material?.abort();
    state.materialMode = button.dataset.mode;
    state.materialRecordId = null;
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

  // 同步手机浏览器返回键、前进键和手动修改地址栏哈希。
  window.addEventListener("hashchange", () => {
    const view = location.hash.slice(1);
    if (viewMeta[view]) navigate(view);
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
    if (data.model) $("#model-name").textContent = data.model;
  } catch {
    state.serverHasKey = null;
  }
  const initialView = location.hash.slice(1);
  navigate(viewMeta[initialView] ? initialView : "home");
}

init();
