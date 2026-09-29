const DEFAULT_BASE_URL = "https://api.deepseek.com";

/**
 * DeepSeek 适配器。外部只依赖 analyze 方法，后续增加其他模型时无需修改业务层。
 */
class DeepSeekProvider {
  constructor(options = {}) {
    this.apiKey = options.apiKey;
    this.model = options.model || process.env.DEEPSEEK_MODEL || "deepseek-chat";
    this.baseUrl = (process.env.DEEPSEEK_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, "");
  }

  async analyze(messages) {
    if (!this.apiKey) {
      const error = new Error("请先配置 DeepSeek API Key");
      error.statusCode = 400;
      throw error;
    }

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages,
        temperature: 0.35,
        response_format: { type: "json_object" },
      }),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data?.error?.message || "DeepSeek 请求失败");
      error.statusCode = response.status;
      throw error;
    }

    const content = data?.choices?.[0]?.message?.content;
    if (!content) throw new Error("DeepSeek 未返回有效内容");

    try {
      return JSON.parse(content);
    } catch {
      throw new Error("AI 返回格式异常，请重试");
    }
  }
}

module.exports = DeepSeekProvider;
