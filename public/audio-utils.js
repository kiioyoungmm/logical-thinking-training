function pickAudioMime(Recorder) {
  const choices = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm", "audio/ogg;codecs=opus"];
  return choices.find((type) => Recorder.isTypeSupported?.(type)) || "";
}

function audioExtension(type = "") {
  if (type.includes("mp4")) return "m4a";
  if (type.includes("ogg")) return "ogg";
  if (type.includes("webm")) return "webm";
  return "audio";
}

function formatSeconds(seconds) {
  const value = Math.max(0, Math.floor(Number(seconds) || 0));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`;
}

if (typeof module !== "undefined") module.exports = { pickAudioMime, audioExtension, formatSeconds };
