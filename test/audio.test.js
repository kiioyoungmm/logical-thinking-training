const test = require("node:test");
const assert = require("node:assert/strict");
const { pickAudioMime, audioExtension, formatSeconds } = require("../public/audio-utils");
const { createBackup, parseBackup } = require("../public/review");

test("录音格式按浏览器能力选择，无法检测时交给浏览器默认处理", () => {
  assert.equal(pickAudioMime({ isTypeSupported: (type) => type === "audio/mp4" }), "audio/mp4");
  assert.equal(pickAudioMime({ isTypeSupported: (type) => type === "audio/webm;codecs=opus" }), "audio/webm;codecs=opus");
  assert.equal(pickAudioMime({}), "");
  assert.equal(audioExtension("audio/mp4;codecs=mp4a.40.2"), "m4a");
  assert.equal(audioExtension("audio/webm;codecs=opus"), "webm");
  assert.equal(formatSeconds(120), "2:00");
});

test("口头训练备份只保留时长、自评和转写文字", () => {
  const record = {
    id: 1, type: "checkin", mode: "oral", title: "测试题", createdAt: "2026-10-01T04:00:00.000Z",
    firstAnswer: "第一次转写", secondAnswer: "第二次转写",
    oral: { first: { duration: 30, selfReview: "结论不够明确" }, second: { duration: 42, selfReview: "改写更有条理" } },
  };
  const backup = JSON.stringify(createBackup({ records: [record], questionHistory: [] }));
  assert.ok(!backup.includes("blob:"));
  assert.deepEqual(parseBackup(backup).records[0].oral, record.oral);
  record.oral.second.duration = 999;
  assert.throws(() => parseBackup(JSON.stringify(createBackup({ records: [record], questionHistory: [] }))), /记录格式/);
});
