const DEFAULT_BASE_URL = "https://api.deepseek.com";
const RETRY_DELAY_MS = 800;

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/**
 * DeepSeek 适配器。外部只依赖 analyze 方法，后续增加其他模型时无需修改业务层。
 */
class DeepSeekProvider {
  constructor(options = {}) {
    this.apiKey = options.apiKey;
    this.model = options.model || process.env.DEEPSEEK_MODEL || "deepseek-flash";
    this.baseUrl = (process.env.DEEPSEEK_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, "");
    this.fetch = options.fetch || fetch;
    this.timeoutMs = options.timeoutMs || 45000;
  }

  async analyze(messages, validate = (value) => value, signal) {
    if (!this.apiKey) {
      const error = new Error("请先配置 DeepSeek API Key");
      error.statusCode = 400;
      throw error;
    }

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        if (signal?.aborted) {
          const error = new Error("请求已取消");
          error.statusCode = 499;
          throw error;
        }
        const response = await this.fetch(`${this.baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify({
            model: this.model,
            messages,
            // 结构化训练只需要最终结论；关闭默认思考模式，避免推理耗尽输出额度。
            thinking: { type: "disabled" },
            temperature: 0.35,
            response_format: { type: "json_object" },
            max_tokens: 3000,
          }),
          signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(this.timeoutMs)]) : AbortSignal.timeout(this.timeoutMs),
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          const error = new Error(response.status === 401 ? "DeepSeek API Key 无效" : response.status === 402 ? "DeepSeek 账户余额不足" : response.status === 429 ? "DeepSeek 请求过于频繁，请稍后重试" : [400, 404].includes(response.status) ? "DeepSeek 请求被拒绝，请检查模型配置" : "DeepSeek 服务暂时不可用");
          error.statusCode = response.status;
          error.retryable = response.status === 429 || response.status >= 500;
          throw error;
        }

        const content = data?.choices?.[0]?.message?.content;
        if (!content) {
          const error = new Error("DeepSeek 返回了空内容，请重试");
          error.statusCode = 502;
          error.retryable = true;
          throw error;
        }
        let parsed;
        try {
          parsed = JSON.parse(content);
        } catch {
          const error = new Error("DeepSeek 返回格式异常，请重试");
          error.statusCode = 502;
          error.retryable = true;
          throw error;
        }
        return validate(parsed);
      } catch (error) {
        if (signal?.aborted) {
          const cancelled = new Error("请求已取消");
          cancelled.statusCode = 499;
          throw cancelled;
        }
        // 只重试网络、限流和格式问题；认证或余额错误应立即返回。
        if (!error.statusCode) {
          const timeout = error.name === "TimeoutError" || error.name === "AbortError";
          error = Object.assign(new Error(timeout ? "DeepSeek 请求超时，请稍后重试" : "无法连接 DeepSeek，请检查网络或代理设置"), { statusCode: 503, retryable: true });
        }
        if (!error.retryable || attempt === 1) throw error;
        await wait(RETRY_DELAY_MS);
      }
    }
  }
}

module.exports = DeepSeekProvider;
