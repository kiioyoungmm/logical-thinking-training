const STORAGE_KEY = "logical-training-data-v1";
const SESSION_KEY = "deepseek-api-key";

let questions = [];

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
  question: null,
  questionReason: "",
  attempt: 1,
  firstAnswer: "",
  firstFeedback: null,
  checkinMode: "text",
  oralClips: { first: null, second: null },
  materialMode: "training",
  serverHasKey: null,
  completedRecordId: null,
  materialRecordId: null,
};

const store = loadStore();
let toastTimer;
const activeRequests = { checkin: null, material: null, variant: null };
let recordingToken = 0;
let recordingPending = false;
let currentRecording = null;

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
    const data = JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
    return { records: Array.isArray(data.records) ? data.records : [], questionHistory: Array.isArray(data.questionHistory) ? data.questionHistory : [] };
  } catch {
    return { records: [], questionHistory: [] };
  }
}

function saveStore() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}

function getLocalDateKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
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
  if (view !== "checkin") {
    if (recordingPending || currentRecording) cancelRecording();
    ["#oral-audio", "#oral-first-audio"].forEach((selector) => $(selector).pause());
  }
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

function chooseQuestion(force = false) {
  const today = getLocalDateKey();
  const saved = !force && [...store.questionHistory].reverse().find((item) => item.date === today && questions.some((question) => question.id === item.id));
  const question = saved ? questions.find((item) => item.id === saved.id) : selectQuestion(questions, store.questionHistory, store.records, today);
  if (!question) return;
  if (!saved) {
    store.questionHistory.push({ id: question.id, date: today });
    store.questionHistory = store.questionHistory.slice(-100);
    saveStore();
  }
  state.question = question;
  const averages = getAbilityAverages();
  const weakest = Object.keys(averages).sort((a, b) => averages[a] - averages[b])[0];
  state.questionReason = store.records.some(hasVerifiedScores) && question.skills.includes(weakest) ? `针对弱项：${scoreLabels[weakest]}` : "精选训练";
}

function renderQuestion() {
  const question = state.question;
  if (!question) {
    $("#question-title").textContent = "题库加载失败，请刷新页面重试";
    $("#submit-checkin").disabled = true;
    return;
  }
  $("#submit-checkin").disabled = false;
  $("#question-category").textContent = question.category;
  $("#question-difficulty").textContent = ["", "初级", "中级", "高级"][question.difficulty];
  $("#question-number").textContent = `${question.sourceId ? "AI 变式 · " : ""}${state.questionReason} · 题库 ${questions.length} 题`;
  $("#question-title").textContent = question.title;
  $("#question-context").textContent = question.context;
  $("#question-requirements").innerHTML = question.requirements.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
  $("#question-focus").textContent = `评分重点：${question.focus}`;
}

function resetCheckin() {
  clearOralClips();
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
  renderOralPanel();
}

function stopTracks(stream) {
  stream?.getTracks().forEach((track) => track.stop());
}

function cancelRecording() {
  recordingToken += 1;
  recordingPending = false;
  const active = currentRecording;
  currentRecording = null;
  if (active) {
    clearInterval(active.timer);
    active.recorder.onstop = null;
    try { if (active.recorder.state !== "inactive") active.recorder.stop(); } catch { /* 设备已断开时仍释放麦克风。 */ }
    stopTracks(active.stream);
  }
  renderOralPanel();
}

function clearOralClips() {
  cancelRecording();
  ["#oral-audio", "#oral-first-audio"].forEach((selector) => {
    const player = $(selector);
    player.pause();
    player.removeAttribute("src");
    player.load();
  });
  Object.values(state.oralClips).forEach((clip) => { if (clip) URL.revokeObjectURL(clip.url); });
  state.oralClips = { first: null, second: null };
}

function renderOralPanel() {
  const oral = state.checkinMode === "oral";
  $("#oral-panel").classList.toggle("hidden", !oral);
  $("#answer-label").textContent = oral ? "手动整理刚才说的话（AI 仅评价下方文字）" : "写下你的回答";
  $all("[data-checkin-mode]").forEach((button) => button.classList.toggle("active", button.dataset.checkinMode === state.checkinMode));
  $("#checkin-answer").placeholder = oral ? "请手动写下刚才说的内容，再获取 AI 反馈……" : "先用一句话写出结论，再给出 2～3 个理由……";
  if (!oral) return;
  const round = state.attempt === 1 ? "first" : "second";
  const clip = state.oralClips[round];
  const player = $("#oral-audio");
  $("#oral-playback").classList.toggle("hidden", !clip);
  if (clip && player.getAttribute("src") !== clip.url) player.src = clip.url;
  if (!clip && player.getAttribute("src")) { player.pause(); player.removeAttribute("src"); player.load(); }
  if (clip) {
    $("#oral-download").href = clip.url;
    $("#oral-download").download = `理序-${round === "first" ? "初答" : "改写"}-${getLocalDateKey()}.${audioExtension(clip.type)}`;
  }
  const first = state.attempt === 2 ? state.oralClips.first : null;
  $("#oral-first-playback").classList.toggle("hidden", !first);
  if (first && $("#oral-first-audio").getAttribute("src") !== first.url) $("#oral-first-audio").src = first.url;
  $("#oral-self-review").value = clip?.selfReview || "";
  $("#start-recording").disabled = recordingPending || Boolean(currentRecording);
  $("#stop-recording").classList.toggle("hidden", !currentRecording);
  $("#stop-recording").disabled = Boolean(currentRecording?.stopping);
  $("#oral-duration").disabled = recordingPending || Boolean(currentRecording);
  $("#oral-status").textContent = recordingPending ? "等待麦克风权限……" : currentRecording ? `剩余 ${formatSeconds(currentRecording.limit)}` : clip ? `已录制 ${formatSeconds(clip.duration)}` : "未录音";
}

function stopRecording() {
  const active = currentRecording;
  if (!active || active.stopping) return;
  active.stopping = true;
  clearInterval(active.timer);
  $("#stop-recording").disabled = true;
  $("#oral-status").textContent = "正在生成录音……";
  try { active.recorder.stop(); } catch { cancelRecording(); showToast("录音未能正常结束，请重试"); }
}

async function startRecording() {
  if (state.checkinMode !== "oral" || recordingPending || currentRecording) return;
  if (!window.isSecureContext) return showToast("录音需要 HTTPS 或 localhost 安全环境");
  if (!window.MediaRecorder || !navigator.mediaDevices?.getUserMedia) return showToast("当前浏览器不支持录音，可继续文字训练");
  const token = ++recordingToken;
  const round = state.attempt === 1 ? "first" : "second";
  const limit = Number($("#oral-duration").value);
  recordingPending = true;
  renderOralPanel();
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    if (token !== recordingToken) return stopTracks(stream);
    const mime = pickAudioMime(window.MediaRecorder);
    let recorder;
    try { recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined); }
    catch { recorder = new MediaRecorder(stream); } // 指定格式失败时交给浏览器选择。
    const chunks = [];
    const startedAt = performance.now();
    recorder.ondataavailable = (event) => { if (event.data?.size) chunks.push(event.data); };
    recorder.onerror = () => { if (token === recordingToken) { cancelRecording(); showToast("录音失败，请重试或改用文字训练"); } };
    recorder.onstop = () => {
      stopTracks(stream);
      if (token !== recordingToken) return;
      clearInterval(currentRecording?.timer);
      currentRecording = null;
      const type = recorder.mimeType || chunks[0]?.type || "application/octet-stream";
      const blob = new Blob(chunks, { type });
      if (!blob.size) { renderOralPanel(); return showToast("没有录到声音，请重试"); }
      const previous = state.oralClips[round];
      if (previous) URL.revokeObjectURL(previous.url);
      state.oralClips[round] = { url: URL.createObjectURL(blob), type, duration: Math.min(limit, Math.max(1, Math.round((performance.now() - startedAt) / 1000))), selfReview: "" };
      renderOralPanel();
    };
    recorder.start();
    currentRecording = { recorder, stream, limit, timer: null, stopping: false };
    currentRecording.timer = setInterval(() => {
      if (token !== recordingToken || !currentRecording) return;
      const left = Math.max(0, limit - Math.floor((performance.now() - startedAt) / 1000));
      $("#oral-status").textContent = `剩余 ${formatSeconds(left)}`;
      if (left === 0) stopRecording();
    }, 250);
  } catch (error) {
    stopTracks(stream);
    if (token === recordingToken) {
      const message = error.name === "NotAllowedError" ? "未获得麦克风权限，可继续文字训练"
        : error.name === "NotFoundError" ? "未找到麦克风，可继续文字训练"
        : error.name === "NotReadableError" ? "麦克风可能被其他程序占用"
        : "无法开始录音，请检查麦克风或浏览器设置";
      showToast(message);
    }
  } finally {
    if (token === recordingToken) { recordingPending = false; renderOralPanel(); }
  }
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
    <div class="issue-card"><strong>${escapeHtml(item.type || "需要留意")}${ISSUE_TAGS.includes(item.tag) ? `<small class="issue-tag">${escapeHtml(item.tag)}</small>` : ""}</strong>${item.quote ? `<em>“${escapeHtml(item.quote)}”</em>` : ""}<span>${escapeHtml(item.explanation || "")}</span></div>
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
  state.firstFeedback = feedback;
  state.attempt = 2;
  $("#answer-title").textContent = "第二次作答";
  $("#answer-step").textContent = "2 / 2";
  $("#checkin-answer").value = state.firstAnswer;
  $("#checkin-count").textContent = String(state.firstAnswer.length);
  $("#submit-checkin").textContent = "提交改写并完成训练";
  $("#checkin-feedback").classList.add("hidden");
  renderOralPanel();
  $("#checkin-answer").focus();
  $(".answer-card").scrollIntoView({ behavior: "smooth", block: "start" });
  showToast(state.checkinMode === "oral" ? "请重新口述、回放自评，再修改转写文字" : "请根据反馈修改原文，再提交一次");
}

async function submitCheckin() {
  if (activeRequests.checkin) return;
  const question = state.question;
  if (!question) return showToast("题库尚未加载");
  const answer = $("#checkin-answer").value.trim();
  if (answer.length < 30) return showToast("至少写 30 个字，才能进行有效分析");
  if (state.attempt === 2 && answer === state.firstAnswer) return showToast("请先根据反馈修改内容，再提交第二次作答");
  if (state.checkinMode === "oral") {
    if (recordingPending || currentRecording) return showToast("请先结束本轮录音");
    const clip = state.oralClips[state.attempt === 1 ? "first" : "second"];
    if (!clip) return showToast("请先完成本轮录音并回放");
    const selfReview = $("#oral-self-review").value.trim();
    if (selfReview.length < 10) return showToast("请先写至少 10 个字的回放自评");
    clip.selfReview = selfReview;
  }

  const button = $("#submit-checkin");
  const controller = new AbortController();
  activeRequests.checkin = controller;
  setButtonLoading(button, true, "正在分析……");
  $("#cancel-checkin").classList.remove("hidden");
  $("#checkin-feedback").classList.add("hidden");
  try {
    const feedback = await callAi("checkin", {
      questionId: question.sourceId || question.id,
      ...(question.sourceId ? { question } : {}),
      answer,
      previousAnswer: state.attempt === 2 ? state.firstAnswer : "",
      previousFeedback: state.attempt === 2 ? state.firstFeedback : null,
    }, controller.signal);
    const normalized = renderCheckinFeedback(feedback);
    if (state.attempt === 1) state.firstAnswer = answer;
    if (state.attempt === 2) {
      const record = {
        type: "checkin",
        title: question.title,
        questionId: question.sourceId || question.id,
        category: question.category,
        difficulty: question.difficulty,
        variant: Boolean(question.sourceId),
        ...(question.sourceId ? { variantQuestion: { title: question.title, context: question.context, requirements: question.requirements, focus: question.focus } } : {}),
        score: normalized.total,
        scores: normalized.scores,
        summary: normalized.summary,
        firstAnswer: state.firstAnswer,
        secondAnswer: answer,
        firstFeedback: state.firstFeedback,
        secondFeedback: normalized,
        mode: state.checkinMode,
        ...(state.checkinMode === "oral" ? { oral: {
          first: { duration: state.oralClips.first.duration, selfReview: state.oralClips.first.selfReview },
          second: { duration: state.oralClips.second.duration, selfReview: state.oralClips.second.selfReview },
        } } : {}),
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

async function generateVariant() {
  if (!state.question || activeRequests.variant) return;
  if (activeRequests.checkin) return showToast("请等待评分完成或先取消请求");
  if (recordingPending || currentRecording) return showToast("请先停止录音，再生成变式题");
  const sourceId = state.question.sourceId || state.question.id;
  const controller = new AbortController();
  activeRequests.variant = controller;
  const button = $("#generate-variant");
  setButtonLoading(button, true, "正在生成……");
  $("#cancel-variant").classList.remove("hidden");
  try {
    const result = await callAi("variant", { questionId: sourceId }, controller.signal);
    state.question = { ...result, id: `V-${Date.now()}` };
    resetCheckin();
    renderQuestion();
    showToast("已生成同类变式题，原题仍保留在题库中");
  } catch (error) {
    showToast(controller.signal.aborted ? "已取消生成" : error.message);
  } finally {
    activeRequests.variant = null;
    setButtonLoading(button, false);
    $("#cancel-variant").classList.add("hidden");
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
    const record = { type: "material", title: result.topic || material.slice(0, 36), summary: result.feedback || "已完成材料分析", material, userClaim, userEvidence, analysis: result, meta: result.meta };
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
  const scored = store.records.filter(hasVerifiedScores).slice(0, 10);
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
  renderWeeklyReview();
  const list = $("#record-list");
  if (!store.records.length) {
    list.innerHTML = '<div class="empty-state"><strong>还没有训练记录</strong>完成一次打卡或材料分析后，记录会出现在这里。</div>';
    return;
  }
  list.innerHTML = store.records.map((record) => {
    const date = new Date(record.createdAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
    const score = hasVerifiedScores(record) ? record.score : record.type === "material" ? "分析" : "未核验";
    const tags = [...new Set([...getIssueTags(record.firstFeedback), ...getIssueTags(record.secondFeedback)])];
    const oral = record.mode === "oral" && record.oral ? `
        <p class="record-comparison">口头训练 · 初答 ${escapeHtml(formatSeconds(record.oral.first?.duration))} · 改写 ${escapeHtml(formatSeconds(record.oral.second?.duration))}（音频未长期保存）</p>
        <h4>初答回放自评</h4><p class="record-answer">${escapeHtml(record.oral.first?.selfReview || "")}</p>
        <h4>改写回放自评</h4><p class="record-answer">${escapeHtml(record.oral.second?.selfReview || "")}</p>` : "";
    const detail = record.type === "checkin" && record.firstAnswer && record.secondAnswer ? `
      <details class="record-detail"><summary>查看初答与改写${record.firstFeedback?.total != null ? ` · ${escapeHtml(record.firstFeedback.total)} → ${escapeHtml(record.score)} 分` : ""}</summary>
        ${tags.length ? `<p class="record-tags">问题标签：${tags.map(escapeHtml).join(" · ")}</p>` : ""}
        ${oral}
        <h4>第一次作答</h4><p class="record-answer">${escapeHtml(record.firstAnswer)}</p>
        <h4>第二次作答</h4><p class="record-answer">${escapeHtml(record.secondAnswer)}</p>
        ${record.secondFeedback?.comparison ? `<p class="record-comparison">${escapeHtml(record.secondFeedback.comparison)}</p>` : ""}
      </details>` : record.type === "material" && record.material ? `
      <details class="record-detail"><summary>查看分析材料</summary><p class="record-answer">${escapeHtml(record.material)}</p></details>` : "";
    return `<article class="record-card"><time>${escapeHtml(date)}</time><div><h3>${escapeHtml(record.title)}${record.mode === "oral" ? '<small class="record-mode">口头</small>' : ""}</h3><p>${escapeHtml(record.summary || "已完成训练")}</p></div><span class="record-score">${escapeHtml(score)}</span>${detail}</article>`;
  }).join("");
}

function renderWeeklyReview() {
  const review = buildWeeklyReview(store.records);
  const panel = $("#weekly-review");
  if (!review.sessions) {
    panel.innerHTML = "<h3>最近 7 天</h3><p>完成一次双轮打卡后，这里会总结进步和反复出现的问题。</p>";
    return;
  }
  const progress = review.compared
    ? `完成 ${review.sessions} 次打卡；有初答记录的 ${review.compared} 次平均提升 ${review.averageGain >= 0 ? "+" : ""}${review.averageGain} 分${review.mostImproved ? `，进步最多的是“${scoreLabels[review.mostImproved]}”` : ""}。`
    : `完成 ${review.sessions} 次打卡。旧记录未保存初答，暂时无法计算改写进步。`;
  const problems = review.topTags.length
    ? review.topTags.map(([tag, count]) => `<li>${escapeHtml(tag)} <span>${count} 次</span></li>`).join("")
    : "<li>暂无可统计的问题标签，新完成的训练会逐步积累。</li>";
  panel.innerHTML = `<h3>最近 7 天</h3><p>${progress}</p><strong>最常出现的三个问题</strong><ol>${problems}</ol>`;
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
  const topTag = buildWeeklyReview(store.records).topTags[0]?.[0];
  $("#profile-focus").textContent = `下一阶段：${scoreLabels[weakest]}`;
  $("#profile-advice").textContent = topTag
    ? `最近的记录提示“${topTag}”，当前“${scoreLabels[weakest]}”平均得分最低。接下来三次训练优先检查这两点。`
    : `当前“${scoreLabels[weakest]}”平均得分最低。接下来三次训练优先改善这一项，不必同时解决所有问题。`;
}

function renderKeyStatus() {
  const ready = hasAiKey();
  const status = $("#key-status");
  status.textContent = ready ? (sessionStorage.getItem(SESSION_KEY) ? "会话中已配置" : "服务器已配置") : state.serverHasKey === null ? "无法检测服务" : "未配置";
  status.classList.toggle("ready", ready);
  $("#api-key").value = sessionStorage.getItem(SESSION_KEY) || "";
}

function exportData() {
  const blob = new Blob([JSON.stringify(createBackup(store), null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `理序训练备份-${getLocalDateKey()}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  showToast("备份已下载，请妥善保存");
}

async function importData(event) {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;
  try {
    if (file.size > 5 * 1024 * 1024) throw new Error("备份文件不能超过 5 MB");
    const restored = parseBackup(await file.text());
    if (!window.confirm(`将用备份中的 ${restored.records.length} 条记录覆盖当前数据。建议先导出当前备份。确定继续吗？`)) return;
    // 先写入新数据，成功后再替换内存；写入失败时保留原记录。
    localStorage.setItem(STORAGE_KEY, JSON.stringify(restored));
    Object.values(activeRequests).forEach((controller) => controller?.abort());
    store.records = restored.records;
    store.questionHistory = restored.questionHistory;
    state.materialRecordId = null;
    chooseQuestion();
    resetCheckin();
    renderQuestion();
    renderHome();
    renderRecords();
    renderProfile();
    showToast("备份已恢复");
  } catch (error) {
    showToast(`恢复失败：${error.message}`);
  }
}

function bindEvents() {
  $all("[data-view]").forEach((button) => button.addEventListener("click", () => navigate(button.dataset.view)));
  $all("[data-checkin-mode]").forEach((button) => button.addEventListener("click", () => {
    if (button.dataset.checkinMode === state.checkinMode) return;
    if (recordingPending || currentRecording) return showToast("请先停止录音，再切换训练方式");
    if (activeRequests.checkin) return showToast("请等待评分完成或先取消请求");
    if ((state.firstFeedback || $("#checkin-answer").value.trim() || state.oralClips.first || state.oralClips.second)
      && !window.confirm("切换方式会清空当前作答和临时录音；已完成的记录不受影响。确定继续吗？")) return;
    state.checkinMode = button.dataset.checkinMode;
    resetCheckin();
  }));
  $("#start-recording").addEventListener("click", startRecording);
  $("#stop-recording").addEventListener("click", stopRecording);
  $("#oral-self-review").addEventListener("input", (event) => {
    const clip = state.oralClips[state.attempt === 1 ? "first" : "second"];
    if (clip) clip.selfReview = event.target.value;
  });
  $("#change-question").addEventListener("click", () => {
    activeRequests.checkin?.abort();
    activeRequests.variant?.abort();
    if (!questions.length) return showToast("题库尚未加载");
    chooseQuestion(true);
    resetCheckin();
    renderQuestion();
  });
  $("#generate-variant").addEventListener("click", generateVariant);
  $("#cancel-variant").addEventListener("click", () => activeRequests.variant?.abort());
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
  $("#export-data").addEventListener("click", exportData);
  $("#import-data").addEventListener("click", () => $("#backup-file").click());
  $("#backup-file").addEventListener("change", importData);
  $("#clear-records").addEventListener("click", () => {
    if (!store.records.length) return showToast("当前没有训练记录");
    if (!window.confirm("确定清空全部训练记录吗？此操作无法恢复。")) return;
    store.records = [];
    saveStore();
    renderRecords();
    renderHome();
    renderProfile();
    showToast("训练记录已清空");
  });

  // 同步手机浏览器返回键、前进键和手动修改地址栏哈希。
  window.addEventListener("hashchange", () => {
    const view = location.hash.slice(1);
    if (viewMeta[view]) navigate(view);
  });
  window.addEventListener("pagehide", clearOralClips);
}

async function init() {
  bindEvents();
  try {
    const response = await fetch("/api/questions");
    if (!response.ok) throw new Error("题库加载失败");
    const data = await response.json();
    questions = data.questions;
    chooseQuestion();
  } catch {
    showToast("题库加载失败，请刷新页面重试");
  }
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
