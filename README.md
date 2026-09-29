# 理序 · 逻辑思维与表达训练

一个移动端优先的个人训练网站，包含两条核心流程：

- 打卡训练：系统出题 → 第一次作答 → 点评 → 第二次作答 → 能力记录
- 材料分析：粘贴材料 → 自己先拆解（可选）→ 结构与逻辑分析

## 启动

需要 Node.js 18 或更高版本，无需安装第三方依赖。

```bash
npm start
```

浏览器打开 `http://localhost:3000`。

## 配置 DeepSeek

任选一种方式：

1. 在网页“模型设置”中填写 API Key。Key 只保存在当前浏览器会话，关闭浏览器后清除。
2. 在服务器配置环境变量 `DEEPSEEK_API_KEY`。可参考 `.env.example`，注意 Node.js 不会自动读取 `.env` 文件。

未配置或 AI 请求失败时，系统会自动使用本地基础规则，保证训练流程仍然可用。

## 代码结构

```text
public/                 前端页面、样式和交互
server/providers/       AI 模型适配器
server/skills/          两套独立 Prompt Skill
server/ai.js            AI 任务入口
server.js               静态服务与 API 代理
```

当前版本不包含账号和数据库，训练记录保存在浏览器 `localStorage`。这样更适合个人使用，也方便以后再按需要增加云同步、小程序端或其他模型。
