/* HTTP 服务：Fastify 接请求。业务处理函数仍直接写 Node 的响应（流式成稿、支付原文、上传都靠这个）。 */
import Fastify from 'fastify';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { loadEnv } from './env.js';
import { fromRoot } from './paths.js';

loadEnv();

const { HttpError, ensureBootstrapAdmin, ensureAccessUser, syncAdminPassword } = await import('./auth.js');
const R = await import('./routes.js');
const { providerInfo, setUsageSink } = await import('./llm.js');
const { DATA_DIR, Usage } = await import('./db.js');
const { attachSecurity } = await import('./security.js');
const { rateLimit } = await import('./limit.js');

await ensureBootstrapAdmin();
await ensureAccessUser();
await syncAdminPassword();
const { warmSettings } = await import('./settings.js');
await warmSettings();
const { syncPromptBuiltins } = await import('./promptrev.js');
await syncPromptBuiltins();
// 上次没跑完的长任务：退回预扣、重新排队，再投进 Redis / BullMQ
const { recoverJobs, startQueue } = await import('./jobs.js');
await recoverJobs();
await startQueue();

// 每次模型调用落一条用量记录，供管理后台统计
setUsageSink((e) => {
  void Usage.record(e).catch((err) => console.warn('[usage]', err.message));
});

const PUBLIC_DIR = fromRoot('public');
// Vue 前端的构建产物（npm run build:web → dist/）。手写的页面、样式、后台还在 public/
const DIST_DIR = fromRoot('dist');
const PORT = Number(process.env.PORT) || 5177;
const HOST = process.env.HOST || '0.0.0.0';
const MAX_BODY = 256 * 1024;

const ROUTES = [
  ['POST', /^\/api\/auth\/register$/, R.handleRegister],
  ['POST', /^\/api\/auth\/login$/, R.handleLogin],
  ['POST', /^\/api\/auth\/logout$/, R.handleLogout],
  ['GET', /^\/api\/me$/, R.handleMe],
  ['GET', /^\/api\/meta$/, R.handleMeta],
  ['GET', /^\/api\/personas$/, R.handlePersonaList],
  ['POST', /^\/api\/personas$/, R.handlePersonaCreate],
  ['POST', /^\/api\/personas\/quickstart$/, R.handleQuickstart],
  ['PUT', /^\/api\/personas\/(?<id>\d+)$/, R.handlePersonaUpdate],
  ['DELETE', /^\/api\/personas\/(?<id>\d+)$/, R.handlePersonaDelete],
  ['GET', /^\/api\/personas\/(?<id>\d+)\/sections$/, R.handleSectionList],
  ['POST', /^\/api\/personas\/(?<id>\d+)\/sections$/, R.handleSectionCreate],
  ['PUT', /^\/api\/personas\/(?<id>\d+)\/sections\/(?<sectionId>\d+)$/, R.handleSectionUpdate],
  ['DELETE', /^\/api\/personas\/(?<id>\d+)\/sections\/(?<sectionId>\d+)$/, R.handleSectionDelete],
  ['GET', /^\/api\/personas\/(?<id>\d+)\/samples$/, R.handleSampleList],
  ['POST', /^\/api\/personas\/(?<id>\d+)\/samples$/, R.handleSampleCreate],
  ['POST', /^\/api\/personas\/(?<id>\d+)\/samples\/batch$/, R.handleSampleBatch],
  ['DELETE', /^\/api\/personas\/(?<id>\d+)\/samples\/(?<sampleId>\d+)$/, R.handleSampleDelete],
  ['POST', /^\/api\/personas\/(?<id>\d+)\/digest$/, R.handleDigestRebuild],
  ['GET', /^\/api\/admin\/session$/, R.handleAdminSession],
  ['POST', /^\/api\/admin\/setup$/, R.handleAdminSetup],
  ['POST', /^\/api\/admin\/login$/, R.handleAdminLogin],
  ['POST', /^\/api\/admin\/logout$/, R.handleAdminLogout],
  ['GET', /^\/api\/admin\/overview$/, R.handleAdminOverview],
  ['GET', /^\/api\/admin\/prompts$/, R.handleAdminPrompts],
  ['GET', /^\/api\/admin\/settings$/, R.handleSettingsList],
  ['POST', /^\/api\/admin\/settings$/, R.handleSettingsSave],
  ['GET', /^\/api\/admin\/settings\/check$/, R.handleSettingsCheck],
  ['GET', /^\/api\/admin\/variants$/, R.handlePromptVariantList],
  ['POST', /^\/api\/admin\/variants$/, R.handlePromptVariantSave],
  ['PUT', /^\/api\/admin\/variants\/(?<vid>\d+)$/, R.handlePromptVariantSave],
  ['DELETE', /^\/api\/admin\/variants\/(?<vid>\d+)$/, R.handlePromptVariantDelete],
  ['GET', /^\/api\/admin\/eval\/cases$/, R.handleEvalCases],
  ['POST', /^\/api\/admin\/eval\/cases$/, R.handleEvalCaseAdd],
  ['DELETE', /^\/api\/admin\/eval\/cases\/(?<cid>\d+)$/, R.handleEvalCaseDelete],
  ['POST', /^\/api\/admin\/eval\/run$/, R.handleEvalRun],
  ['GET', /^\/api\/admin\/eval\/batches$/, R.handleEvalBatches],
  ['GET', /^\/api\/admin\/eval\/(?<batch>[\w-]+)$/, R.handleEvalResult],
  ['POST', /^\/api\/admin\/eval\/(?<batch>[\w-]+)\/vote$/, R.handleEvalVote],
  ['GET', /^\/api\/hotspots$/, R.handleBoards],
  ['GET', /^\/api\/personas\/(?<id>\d+)\/hotspots$/, R.handleHotspotRead],
  ['POST', /^\/api\/personas\/(?<id>\d+)\/hotspots$/, R.handleHotspotAnalyze],
  ['GET', /^\/api\/personas\/(?<id>\d+)\/subjects$/, R.handleSubjectList],
  ['POST', /^\/api\/personas\/(?<id>\d+)\/subjects$/, R.handleSubjectGenerate],
  ['POST', /^\/api\/drafts\/topics$/, R.handleTopics],
  ['POST', /^\/api\/drafts\/(?<id>\d+)\/topics$/, R.handleRetopics],
  ['POST', /^\/api\/drafts\/(?<id>\d+)\/content$/, R.handleContent],
  ['PUT', /^\/api\/drafts\/(?<id>\d+)\/content$/, R.handleSaveContent],
  ['GET', /^\/api\/drafts\/(?<id>\d+)\/revisions$/, R.handleRevisionList],
  ['GET', /^\/api\/drafts\/(?<id>\d+)\/revisions\/(?<rid>\d+)$/, R.handleRevisionGet],
  ['POST', /^\/api\/drafts\/(?<id>\d+)\/assist$/, R.handleAssist],
  ['POST', /^\/api\/drafts\/(?<id>\d+)\/voice-edit$/, R.handleVoiceEdit],
  ['POST', /^\/api\/drafts\/(?<id>\d+)\/review$/, R.handleReview],
  ['POST', /^\/api\/drafts\/(?<id>\d+)\/cues$/, R.handleCues],
  ['GET', /^\/api\/drafts\/(?<id>\d+)\/speaks$/, R.handleSpeakList],
  ['POST', /^\/api\/drafts\/(?<id>\d+)\/speaks$/, R.handleSpeakCreate],
  ['GET', /^\/api\/speaks$/, R.handleSpeakList],
  ['GET', /^\/api\/speaks\/(?<sid>\d+)$/, R.handleSpeakGet],
  ['POST', /^\/api\/speaks\/(?<sid>\d+)\/retry$/, R.handleSpeakRetry],
  ['POST', /^\/api\/speaks\/(?<sid>\d+)\/pronounce$/, R.handleSpeakPronounce],
  ['POST', /^\/api\/speaks\/(?<sid>\d+)\/appearance$/, R.handleSpeakAppearance],
  ['DELETE', /^\/api\/speaks\/(?<sid>\d+)$/, R.handleSpeakDelete],
  ['POST', /^\/api\/drafts\/(?<id>\d+)\/variants$/, R.handleVariant],
  ['POST', /^\/api\/drafts\/(?<id>\d+)\/illus$/, R.handleIllus],
  ['POST', /^\/api\/drafts\/(?<id>\d+)\/illus\/(?<i>\d+)\/image$/, R.handleIllusImage],
  ['DELETE', /^\/api\/drafts\/(?<id>\d+)\/variants\/(?<platform>\w+)$/, R.handleVariantDelete],
  ['POST', /^\/api\/drafts\/(?<id>\d+)\/titles$/, R.handleTitles],
  ['PUT', /^\/api\/drafts\/(?<id>\d+)\/title$/, R.handleTitleApply],
  ['GET', /^\/api\/images$/, R.handleImageInfo],
  ['GET', /^\/api\/drafts\/(?<id>\d+)\/export\.docx$/, R.handleExportDocx],
  ['GET', /^\/api\/prompt-docs$/, R.handlePromptDocs],
  ['PUT', /^\/api\/prompt-docs\/(?<key>[\w-]+)$/, R.handlePromptSave],
  ['POST', /^\/api\/prompt-docs\/(?<key>[\w-]+)\/revisions\/(?<rid>\d+)\/activate$/, R.handlePromptActivate],
  ['GET', /^\/api\/personas\/(?<id>\d+)\/materials$/, R.handleMaterialList],
  ['POST', /^\/api\/personas\/(?<id>\d+)\/materials$/, R.handleMaterialCreate],
  ['PUT', /^\/api\/materials\/(?<mid>\d+)$/, R.handleMaterialUpdate],
  ['DELETE', /^\/api\/materials\/(?<mid>\d+)$/, R.handleMaterialDelete],
  ['GET', /^\/api\/frameworks$/, R.handleFrameworkList],
  ['GET', /^\/api\/frameworks\/recommend$/, R.handleFrameworkRecommend],
  ['POST', /^\/api\/frameworks\/extract$/, R.handleFrameworkExtract],
  ['POST', /^\/api\/frameworks$/, R.handleFrameworkCreate],
  ['PUT', /^\/api\/frameworks\/(?<fid>\d+)$/, R.handleFrameworkUpdate],
  ['DELETE', /^\/api\/frameworks\/(?<fid>\d+)$/, R.handleFrameworkDelete],
  ['GET', /^\/api\/jobs$/, R.handleJobList],
  ['GET', /^\/api\/jobs\/(?<jid>\d+)$/, R.handleJobGet],
  ['POST', /^\/api\/jobs\/(?<jid>\d+)\/cancel$/, R.handleJobCancel],
  ['POST', /^\/api\/jobs\/(?<jid>\d+)\/retry$/, R.handleJobRetry],
  ['GET', /^\/api\/pool$/, R.handlePoolList],
  ['POST', /^\/api\/pool$/, R.handlePoolCreate],
  ['PUT', /^\/api\/pool\/(?<pid>\d+)$/, R.handlePoolUpdate],
  ['DELETE', /^\/api\/pool\/(?<pid>\d+)$/, R.handlePoolDelete],
  ['GET', /^\/api\/metrics$/, R.handleMetricsMeta],
  ['GET', /^\/api\/pricing$/, R.handlePricing],
  ['GET', /^\/api\/plan$/, R.handlePlanInfo],
  ['POST', /^\/api\/plan$/, R.handlePlanChange],
  ['GET', /^\/api\/pay$/, R.handlePayInfo],
  ['POST', /^\/api\/pay\/order$/, R.handleOrderCreate],
  ['GET', /^\/api\/pay\/order\/(?<no>\w+)$/, R.handleOrderStatus],
  ['POST', /^\/api\/pay\/notify\/(?<channel>\w+)$/, R.handlePayNotify],
  ['POST', /^\/api\/drafts\/(?<id>\d+)\/metrics$/, R.handleMetricsSave],
  ['GET', /^\/api\/drafts\/(?<id>\d+)\/metrics$/, R.handleMetricsHistory],
  ['DELETE', /^\/api\/drafts\/(?<id>\d+)\/metrics\/(?<mid>\d+)$/, R.handleMetricsDelete],
  ['GET', /^\/api\/insights$/, R.handleReview2],
  ['GET', /^\/api\/drafts$/, R.handleList],
  ['GET', /^\/api\/drafts\/(?<id>\d+)$/, R.handleGet],
  ['POST', /^\/api\/drafts\/(?<id>\d+)\/archive$/, R.handleArchive],
  ['POST', /^\/api\/drafts\/archive-done$/, R.handleArchiveDone],
  ['DELETE', /^\/api\/drafts\/(?<id>\d+)$/, R.handleDelete],
];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
};

async function dispatch(req, res) {
  attachSecurity(res);
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const path = url.pathname;

  if (path === '/health' || path === '/api/health') {
    const info = providerInfo();
    // app 是内部标识（和目录、pm2 进程名一致），name 是给人看的产品名
    R.json(res, 200, { ok: true, app: 'ip-studio', name: '自媒体助手', llm: info.label, live: info.live });
    return;
  }

  if (path.startsWith('/image/')) {
    await serveOwned(path, '/image/', 'images', req, res);
    return;
  }

  if (path.startsWith('/speak/')) {
    await serveOwned(path, '/speak/', 'speaks', req, res);
    return;
  }

  if (path.startsWith('/api/')) {
    try { rateLimit(req, path); }
    catch (err) {
      const status = err instanceof HttpError ? err.status : 429;
      return R.json(res, status, { error: err.message || '请求过于频繁' });
    }
    const match = ROUTES.find(([method, re]) => method === req.method && re.test(path));
    if (!match) return R.json(res, 404, { error: '接口不存在' });

    const params = path.match(match[1]).groups || {};
    try {
      // 口播录音是原始字节，不走 JSON
      if (req.method === 'POST' && /^\/api\/drafts\/\d+\/(speaks|voice-edit)$/.test(path)) {
        const file = await readUpload(req);
        if (path.endsWith('/voice-edit')) await R.handleVoiceEdit(req, res, file, params);
        else await R.handleSpeakCreate(req, res, file, params, url);
        return;
      }
      // 支付回调要原文验签，不能先被 JSON.parse 吃掉
      const raw = req.method === 'POST' && /^\/api\/pay\/notify\//.test(path);
      // 视频测评不带请求体：视频已在服务端，整段交给网关，这里不收截帧
      const body = raw || req.method === 'GET' || req.method === 'DELETE'
        ? {}
        : await readJSON(req);
      await match[2](req, res, body, params, url);
    } catch (err) {
      // QuotaError 自带 402；别把它当 500，前端要靠状态码识别"该升级了"
      const status = err instanceof HttpError ? err.status : (err?.status || 500);
      if (status >= 500) console.error('[api]', path, err);
      if (res.headersSent) { res.end(); return; }
      R.json(res, status, { error: R.describe(err), ...(err?.info ? { quota: err.info } : {}) });
    }
    return;
  }

  /* 根路径：有访问门时直接进应用（登录页），不要再绕 /app。
     没设门时仍按登录态分流落地页——本地演示还要那页。 */
  if (path === '/') {
    const { accessGateOn, currentUser } = await import('./auth.js');
    await serveStatic((accessGateOn() || await currentUser(req)) ? '/index.html' : '/landing.html', res);
    return;
  }

  if (path === '/app' || path === '/app/') {
    const { accessGateOn } = await import('./auth.js');
    if (accessGateOn()) {
      res.writeHead(302, { Location: `/${url.search}` });
      res.end();
      return;
    }
  }

  await serveStatic(path, res);
}

/* Fastify 只负责接连接：请求一进来就在 onRequest 里交给下面的 dispatch，body 解析、限流、报错格式都在 dispatch 里。
 * 所以 bodyLimit、trustProxy 这类 Fastify 选项在这里不起作用，不要再加（客户端 IP 见 limit.js）。 */
const app = Fastify({
  logger: false,
  // 接收完整个请求（头 + 体）的时限。24MB 录音在慢网络上要一会儿，给 5 分钟，和 Node 的默认值一致。
  // 流式成稿是响应，不受它限制。
  requestTimeout: 300_000,
  // 进到 onRequest 之前 Fastify 自己就拒掉的请求（比如地址里有非法转义 /%zz）：也回 JSON、也带安全头
  frameworkErrors: (err, request, reply) => {
    reply.hijack();
    const res = attachSecurity(reply.raw);
    if (!res.headersSent) res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: '请求地址不合法' }));
  },
});

/* 在 Fastify 读 body 之前把连接交给原来的处理函数，上传和流式输出才不会被截断。 */
app.addHook('onRequest', async (request, reply) => {
  reply.hijack();
  try {
    await dispatch(request.raw, reply.raw);
  } catch (err) {
    console.error('[http]', err);
    if (!reply.raw.headersSent) reply.raw.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    if (!reply.raw.writableEnded) reply.raw.end(JSON.stringify({ error: '服务异常' }));
  }
});

await app.listen({ port: PORT, host: HOST });

/* 优雅停机。pm2 restart / 部署时发 SIGTERM（开发时 Ctrl+C 是 SIGINT）：
 *   1. 不再接新连接；已经在输出的流式成稿、正在上传的录音让它们做完（最多 JOB_DRAIN_MS）；
 *   2. 任务队列把手上的活做完再断开 Redis；
 *   3. 关数据库连接池，退出。
 * 超时还没做完的任务留在表里，下次启动时退回预扣、重新排队。
 * pm2 默认只等 1.6 秒就强杀，ecosystem.config.cjs 里把 kill_timeout 调到了 30 秒。 */
let stopping = false;
async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  console.log(`\n  收到 ${signal}，正在停机：等进行中的请求和任务做完…`);
  const force = setTimeout(() => { console.error('  停机超时，强制退出'); process.exit(1); }, 30_000);
  force.unref();
  try {
    const { stopQueue } = await import('./jobs.js');
    const { closeDb } = await import('./client.js');
    await Promise.allSettled([app.close(), stopQueue()]);
    await closeDb();
    process.exit(0);
  } catch (err) {
    console.error('  停机出错：', err);
    process.exit(1);
  }
}
process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
process.on('SIGINT', () => { void shutdown('SIGINT'); });
// 漏掉的 Promise 拒绝记下来，不让它把整个服务带走（Node 22 默认会直接退出进程）
process.on('unhandledRejection', (err) => { console.error('[unhandledRejection]', err); });

async function readJSON(req, max = MAX_BODY) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > max) throw new HttpError(413, '请求体过大');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new HttpError(400, '请求体不是合法 JSON'); }
}

const MAX_AUDIO = 24 * 1024 * 1024;
const AUDIO_EXT = {
  'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav',
  'audio/webm': 'webm', 'video/webm': 'webm', 'audio/mp4': 'm4a', 'audio/m4a': 'm4a',
  'audio/x-m4a': 'm4a', 'video/mp4': 'mp4', 'audio/ogg': 'ogg', 'video/ogg': 'ogg',
};

async function readUpload(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_AUDIO) throw new HttpError(413, '录音请小于 24MB');
    chunks.push(chunk);
  }
  const buffer = Buffer.concat(chunks);
  const mime = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  let ext = AUDIO_EXT[mime];
  if (!ext) {
    let raw = String(req.headers['x-filename'] || '');
    try { raw = decodeURIComponent(raw); } catch { /* 文件名不是合法转义就按原样取后缀 */ }
    const m = raw.toLowerCase().match(/\.([a-z0-9]+)$/);
    const allow = { mp3: 'mp3', wav: 'wav', webm: 'webm', m4a: 'm4a', mp4: 'mp4', ogg: 'ogg', mpeg: 'mp3' };
    if (m && allow[m[1]]) ext = allow[m[1]];
  }
  if (!ext) throw new HttpError(400, '请上传 mp3、wav、m4a、webm 或 mp4');
  if (!buffer.length) throw new HttpError(400, '录音是空的');
  return { buffer, mime: mime || 'application/octet-stream', ext };
}

/* 用户自己的媒体文件：路径里的 owner 必须就是当前登录用户，别人的文件一律 403 */
const MEDIA_TYPES = {
  wav: 'audio/wav', mp3: 'audio/mpeg', m4a: 'audio/mp4', ogg: 'audio/ogg',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
  bmp: 'image/bmp', svg: 'image/svg+xml',
  mp4: 'video/mp4', webm: 'video/webm',
};

async function serveOwned(path, prefix, dir, req, res) {
  const { currentUser } = await import('./auth.js');
  const user = await currentUser(req);
  if (!user) { res.writeHead(401).end('Unauthorized'); return; }

  const rel = decodeURIComponent(path.slice(prefix.length));   // 查询串已被 URL 解析剥掉
  const [owner, name] = rel.split('/');
  if (String(owner) !== String(user.id) || !/^[\w.-]+$/.test(name || '')) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  try {
    const data = await readFile(join(DATA_DIR, dir, String(user.id), name));
    res.writeHead(200, {
      'Content-Type': MEDIA_TYPES[name.split('.').pop()] || 'application/octet-stream',
      'Content-Length': data.length,
      'Cache-Control': 'private, max-age=3600',
    });
    res.end(data);
  } catch {
    res.writeHead(404).end('Not Found');
  }
}

async function serveStatic(path, res) {
  // 后台和提示词说明书都是独立入口，不走单页应用那套回落
  if (path === '/admin' || path === '/admin/') path = '/admin.html';
  if (path === '/prompts' || path === '/prompts/') path = '/prompts.html';
  if (path === '/app' || path === '/app/') path = '/index.html';
  if (path === '/about' || path === '/about/') path = '/landing.html';
  // 营销落地页。走单独入口，投放链接指这里；/ 上那版是产品说明，两套动线互不影响
  if (path === '/start' || path === '/start/') path = '/promo.html';

  // 应用首页和构建出来的 js 在 dist/
  if (path === '/' || path === '/index.html') { await serveAppShell(res); return; }
  if (path.startsWith('/assets/')) { await serveBuilt(path, res); return; }

  const rel = normalize(path).replace(/^(\.\.[/\\])+/, '');
  const file = join(PUBLIC_DIR, rel);
  if (!file.startsWith(PUBLIC_DIR)) { res.writeHead(403).end('Forbidden'); return; }
  try {
    const data = await readFile(file);
    res.writeHead(200, {
      'Content-Type': MIME[extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  } catch {
    // 单页应用：未知路径回落到首页
    await serveAppShell(res);
  }
}

/* 应用首页（dist/index.html）。没构建过就明说，不要给一个白屏 */
async function serveAppShell(res) {
  try {
    const html = await readFile(join(DIST_DIR, 'index.html'));
    res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-cache' });
    res.end(html);
  } catch {
    res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('前端还没构建：在项目目录运行 npm run build:web（开发时也可以用 npm run dev:web 打开 5180 端口）');
  }
}

/* 构建产物：文件名带内容哈希，内容变了名字就变，可以让浏览器长期缓存。
   找不到就是 404——以前回落成首页 HTML，浏览器只会报一个看不懂的 MIME 错误。 */
async function serveBuilt(path, res) {
  const rel = normalize(path).replace(/^(\.\.[/\\])+/, '');
  const file = join(DIST_DIR, rel);
  if (!file.startsWith(join(DIST_DIR, 'assets'))) { res.writeHead(403).end('Forbidden'); return; }
  try {
    const data = await readFile(file);
    res.writeHead(200, {
      'Content-Type': MIME[extname(file)] || 'application/octet-stream',
      'Cache-Control': 'public, max-age=31536000, immutable',
    });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not Found');
  }
}

{
  const info = providerInfo();
  const where = HOST === '0.0.0.0' ? `http://localhost:${PORT}` : `http://${HOST}:${PORT}`;
  console.log(`\n  自媒体助手 已启动  →  ${where}`);
  console.log(`  模型通道：${info.label}${info.live ? `（${info.model}）` : ' —— 复制 .env.example 为 .env 并填入密钥即可接入真实模型'}`);
  console.log('  任务队列：BullMQ / Redis');
  for (const line of await startupNotes()) console.log(`  ${line}`);
  console.log('');
}

/* 启动时把「线上容易踩的配置」说清楚：不是报错，只是提醒，免得上线后才发现付不了钱、进不了后台 */
async function startupNotes() {
  const notes = [];
  const prod = process.env.NODE_ENV === 'production';
  const { adminSetupNeeded, setupHttpEnabled, accessGateOn } = await import('./auth.js');
  if (await adminSetupNeeded()) {
    notes.push(setupHttpEnabled()
      ? '管理后台：还没有管理员，打开 /admin 做首次设置'
      : '⚠ 管理后台：还没有管理员，公网也关了首次设置。在 .env 里配 ADMIN_USERNAME 和 ADMIN_PASSWORD（至少 8 位，不要和访问密码 ACCESS_PASSWORD 共用）后重启');
  }
  const { payInfo, mockAllowed } = await import('./pay.js');
  const pay = payInfo();
  if (!pay.live) {
    notes.push(prod && !mockAllowed()
      ? '⚠ 支付：没有配置真实支付（PAY_PROVIDER），线上现在收不了钱；演示支付在生产环境也是关的。验收付费流程要么接好微信 / 支付宝，要么临时设 PAY_ALLOW_MOCK=1'
      : '支付：演示模式（不真扣钱）');
  }
  if (accessGateOn()) notes.push('注册：只能用访问密码进入（配了 ACCESS_PASSWORD）');
  else if (process.env.REGISTER_OPEN === '0') notes.push('注册：已关闭（REGISTER_OPEN=0），新用户需要访问密码或在后台开通');
  return notes;
}
