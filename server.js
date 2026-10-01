const http = require("http");
const fs = require("fs");
const path = require("path");
const { runAiTask } = require("./server/ai");
const { loadQuestions } = require("./server/question-bank");

const questions = loadQuestions();

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, "public");
const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
};

function sendJson(response, statusCode, data) {
  response.writeHead(statusCode, { "Content-Type": MIME_TYPES[".json"] });
  response.end(JSON.stringify(data));
}

async function readJson(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 1024 * 1024) throw new Error("请求内容过大");
  }
  return JSON.parse(body || "{}");
}

function serveStatic(request, response) {
  const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
  const relativePath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const filePath = path.resolve(PUBLIC_DIR, relativePath);

  // 防止通过 ../ 读取 public 目录以外的文件。
  if (!filePath.startsWith(`${PUBLIC_DIR}${path.sep}`) && filePath !== path.join(PUBLIC_DIR, "index.html")) {
    sendJson(response, 403, { error: "禁止访问" });
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      if (error.code === "ENOENT") {
        fs.readFile(path.join(PUBLIC_DIR, "index.html"), (indexError, indexContent) => {
          if (indexError) return sendJson(response, 404, { error: "页面不存在" });
          response.writeHead(200, { "Content-Type": MIME_TYPES[".html"] });
          response.end(indexContent);
        });
        return;
      }
      sendJson(response, 500, { error: "读取文件失败" });
      return;
    }
    response.writeHead(200, { "Content-Type": MIME_TYPES[path.extname(filePath)] || "application/octet-stream" });
    response.end(content);
  });
}

const server = http.createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/api/health") {
    return sendJson(response, 200, {
      ok: true,
      provider: "deepseek",
      model: process.env.DEEPSEEK_MODEL || "deepseek-flash",
      envKeyConfigured: Boolean(process.env.DEEPSEEK_API_KEY),
    });
  }

  if (request.method === "GET" && request.url === "/api/questions") {
    return sendJson(response, 200, { version: "1.2.0", questions });
  }

  if (request.method === "POST" && request.url === "/api/ai") {
    const controller = new AbortController();
    response.on("close", () => {
      if (!response.writableEnded) controller.abort();
    });
    try {
      const body = await readJson(request);
      const result = await runAiTask({
        type: body.type,
        payload: body.payload || {},
        apiKey: request.headers["x-deepseek-key"],
        signal: controller.signal,
      });
      return sendJson(response, 200, result);
    } catch (error) {
      if (response.destroyed) return;
      return sendJson(response, error.statusCode || 500, { error: error.message || "AI 服务异常" });
    }
  }

  if (request.method === "GET") return serveStatic(request, response);
  sendJson(response, 405, { error: "请求方法不支持" });
});

server.listen(PORT, () => {
  console.log(`逻辑训练网站已启动：http://localhost:${PORT}`);
});
