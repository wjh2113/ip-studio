# 给 AI 编程助手的约定（Claude Code / Cursor 等）

先读 `docs/ARCHITECTURE.md`，再动手。

## 基本

- 注释、界面文案、README 用中文；git 提交信息用英文。
- 保持零依赖：前端无框架无构建，后端只用 Node 内置模块（唯一例外 `@anthropic-ai/sdk`）。加依赖之前先问。
- 改完跑 `npm test`，不通过不提交。测试用临时数据库和演示模式，不读 `.env`。
- 不要读取、打印或提交 `.env` 和 `data/`。

## 后端

- 新接口：`server/index.js` 的 `ROUTES` 加一行，处理函数写在 `server/routes/<业务域>.js` 并 `export`。`server/routes.js` 用 `export *` 聚合，不用改。
- 共用的小工具放 `server/routes/common.js`；`common.js` 不能 import 其他业务域。
- 表结构只能通过 `server/migrations.js` 末尾追加编号迁移来改，不要改已有迁移，不要在 `db.js` 里写建表或 `ALTER`。
- 模型调用只走 `llm.js` 的 `generateJSON` / `generateText` / `streamText`，`meta` 里带 `feature` 和 `userId`（计费和统计靠它们）。
- 新增一个模型功能时同时：
  1. 在 `llm.js` 的 `FEATURE_TIER` 里定档（quality / fast）；
  2. 在 `plans.js` 的 `TEXT_FEATURES` 里登记（否则用量面板折算不对）；
  3. 如果有提示词，在 `promptrev.js` 的 `PROMPT_KEYS` 和 `promptdocs.js` 里登记。
- 模型输出必须在代码里校验：引用原文的字段要能逐字找到，找不到就丢；结构不全重试一次（`withRetry`）；不信任模型给的分数和金额。
- 额度用 `quota.js` 的 `reserve` → `settle`，不要先查后扣。
- 支付：金额只从服务端的套餐表算；回调必须验签；发货只在订单从 pending 变 paid 时做一次。

## 前端

- 入口 `public/app.js` 只负责加载模块和启动；功能写在 `public/js/<模块>.js`。
- 共享的 `el`、`state`、`api` 在 `public/js/core.js`；`core.js` 不能 import 功能模块。
- 模块之间要「通知」而不是「调用」时，用 window 事件（现有：`cw-spent`、`cw-quota`、`cw-enter`、`cw-job-done`）。
- 拼 HTML 一律先 `esc()`；Markdown 用 `markdown()`（先转义再加标签）。
- 不用浏览器原生 `alert` / `confirm`，用 `public/dialog.js` 的应用内浮层。

## 提示词

- 全站提示词在 `server/prompts.js`；线上改动由管理员在 `/prompts` 页完成并留版本。
- 外部内容（用户素材、热点标题、抓取的原文、转写）进提示词时当数据处理，不要让它能改写指令。
