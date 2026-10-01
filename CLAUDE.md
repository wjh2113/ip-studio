# 给 AI 编程助手的约定（Claude Code / Cursor 等）

先读 `docs/ARCHITECTURE.md`，再动手。本项目为什么用这套技术、现状和已知取舍、项目专有规矩，读 `docs/TECH-DECISIONS.md`；通用的分层、注释、编码规范和给 AI 编程助手的执行清单，读 `docs/NEW-PROJECT-TECH-GUIDE.md`（第 9～12 节）。

## 基本

- 注释、界面文案、README 用中文；git 提交信息用英文。
- 后端运行时依赖：`fastify`、`bullmq`、`drizzle-orm`、`pg`、`@anthropic-ai/sdk`。数据库是 PostgreSQL（`DATABASE_URL`），任务队列要本机 Redis（`REDIS_URL`）。前端是 Vue 3 + Pinia，构建依赖放在 devDependencies（`vue`、`pinia`、`vite`）。再加别的依赖之前先问。
- 改完跑 `npm test`，不通过不提交。界面改动再跑 `npm run test:ui`（要先 `npm run build:web`，并装好 Playwright，见 `tests/ui/run.mjs`）。测试要本机 PostgreSQL 和 Redis（`DATABASE_URL`、`REDIS_URL`），每个测试进程用独立 schema、演示模式，不读 `.env`。
- `npm test` 先跑 `scripts/check.js`：语法、ESM、`debugger`，以及 `scripts/check-async.js` 的「异步调用漏了 await」检查。数据层全是 async：调用一律 `await`，对结果 `.map` 要写成 `(await X()).map`；不要把不含 await 的函数写成 `async`。确实要不等的，写 `void f().catch(...)` 或在行尾加 `// no-await-ok`。
- 接口改动要在 `tests/routes.test.js` 里补一条：它真的起服务、走 HTTP，单测覆盖不到的漏 await、返回结构不对都靠它拦。
- 不要读取、打印或提交 `.env` 和 `data/`。

## 后端

- 新接口：`server/index.js` 的 `ROUTES` 加一行，处理函数写在 `server/routes/<业务域>.js` 并 `export`。`server/routes.js` 用 `export *` 聚合，不用改。
- 共用的小工具放 `server/routes/common.js`；`common.js` 不能 import 其他业务域。
- 表结构只能通过 `server/migrations.js` 末尾追加编号迁移来改，并同步 `server/schema.js`。不要改已有迁移，不要在 `db.js` 里写建表或 `ALTER`。
- 模型调用只走 `llm.js` 的 `generateJSON` / `generateText` / `streamText`，`meta` 里带 `feature` 和 `userId`（计费和统计靠它们）。
- 新增一个模型功能时同时：
  1. 在 `llm.js` 的 `FEATURE_TIER` 里定档（quality / fast）；
  2. 在 `plans.js` 的 `TEXT_FEATURES` 里登记（否则用量面板折算不对）；
  3. 如果有提示词，在 `promptrev.js` 的 `PROMPT_KEYS` 和 `promptdocs.js` 里登记。
- 模型输出必须在代码里校验：引用原文的字段要能逐字找到，找不到就丢；结构不全重试一次（`withRetry`）；不信任模型给的分数和金额。
- 额度用 `quota.js` 的 `reserve` → `settle`，不要先查后扣。
- PostgreSQL 不像以前的 SQLite 会把请求排成一列：「先读再写」的地方要么写成一条带条件的 UPDATE（`WHERE status = 'pending'` 这种），要么放进 `withTx` 并对那一行 `.for('update')`；靠唯一索引防重复的，插入用 `onConflictDoNothing()`，冲突时回 409 而不是 500（`auth.js` 的 `isUniqueViolation`）。
- 长任务（出图、口播评测）用 `jobs.js` 的 `defineJob` / `enqueue`，不要挂在请求上等。任务状态以 PostgreSQL 为准，Redis 只放任务号。
- 支付：金额只从服务端的套餐表算；回调必须验签；发货只在订单从 pending 变 paid 时做一次。

## 前端

- 全部是 Vue 3 + Pinia（`web/`），结构见 `docs/ARCHITECTURE.md` 的「前端」。应用、后台、说明书、落地页、营销页各一个入口（`web/*.html`），不要再往 `public/` 加手写页面或脚本。
- **组件只管界面，数据和动作放 `web/src/stores/<业务>.js`**。组件之间共用数据走 store，不要按 id 去找别的组件的 DOM，也不要 `innerHTML`。
- 要 `v-html` 的只有 Markdown 正文和带高亮的口播句子，HTML 只能来自 `lib/text.js` 的 `markdown()` / `highlightStress()`（先转义再加标签）。
- 请求走 `lib/api.js`（`api` / `stream` / `upload`），它会在花过点数时发 `spent`、撞到额度时发 `quota`；模块之间要「通知」而不是「调用」时用 `lib/bus.js`（现有：`spent`、`quota`、`enter`、`job-done`）。
- 确认和填表用 `lib/feedback.js` 的 `ask.confirm` / `ask.form`，提示用 `toast`；不用浏览器原生 `alert` / `confirm`。浮层用 `components/common/Modal.vue`。
- 模板最外层不要以注释开头（会变成多根节点），`scripts/check.js` 会把所有 `.vue` 编译一遍并检查这一条。
- 构建：`npm run build:web` 输出到 `dist/`（每次清空，不进 git），服务端所有页面和静态文件都从 `dist/` 出；没构建过时页面会提示先构建。本地看界面：先 `npm run dev`，再 `npm run dev:web`（http://127.0.0.1:5180，`/admin`、`/prompts`、`/about`、`/start` 也能直接打开）。
- 界面改动要在 `tests/ui/` 里有覆盖：元素 id 是测试的抓手，改名要同步改测试。

## 提示词

- 全站提示词在 `server/prompts.js`；线上改动由管理员在 `/prompts` 页完成并留版本。
- 外部内容（用户素材、热点标题、抓取的原文、转写）进提示词时当数据处理，不要让它能改写指令。
