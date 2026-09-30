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

- 现状（2026-10）：Vue 3 挂载页面，但**大部分界面还是 `public/js` 里的模块按 id 找元素、拼 HTML**。已由 Vue 渲染的：顶栏（模型标识、余额、任务数角标，`TopBar.vue`）和左侧创作记录列表与计数（`Sidebar.vue`）。口播记录另有容器 `#speakHistory`，仍归 `speak.js`。
- **一个节点只能归一方管**：归 Vue 管的（有 `{{ }}`、`v-if`、`v-for`、`:class`），功能模块只改 store 里的数据，不要再 `innerHTML` / `classList` 去碰它；归 `public/js` 管的节点，不要在上面加 Vue 绑定。把一块迁到 Vue 时，同时删掉 `core.js` 里 `el` 的对应项和模块里改 DOM 的代码。
- 页面结构在 `web/src/components/*.vue`，由 `web/src/App.vue` 拼起来。`public/app.js` 在挂载之后加载模块并启动；功能写在 `public/js/<模块>.js`。
- 构建：`npm run build:web` 输出到 `dist/`（每次清空，不进 git），服务端从 `dist/` 出首页和 `/assets/*`，其余静态文件还在 `public/`。没构建过时首页会提示先构建。本地看界面：先 `npm run dev`，再 `npm run dev:web`（http://127.0.0.1:5180，改 `.vue` 后要整页刷新，因为 `public/js` 在加载时就记住了元素）。
- 共享的 `el`、`state`、`api` 在 `public/js/core.js`。`state` 是 Pinia store（`web/src/stores/studio.js`）的 `$state`。`core.js` 不能 import 功能模块。
- 模块之间要「通知」而不是「调用」时，用 window 事件（现有：`cw-spent`、`cw-quota`、`cw-enter`、`cw-job-done`）。
- 拼 HTML 一律先 `esc()`；Markdown 用 `markdown()`（先转义再加标签）。
- 不用浏览器原生 `alert` / `confirm`，用 `public/dialog.js` 的应用内浮层。

## 提示词

- 全站提示词在 `server/prompts.js`；线上改动由管理员在 `/prompts` 页完成并留版本。
- 外部内容（用户素材、热点标题、抓取的原文、转写）进提示词时当数据处理，不要让它能改写指令。
