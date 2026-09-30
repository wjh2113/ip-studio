/* HTTP 服务：静态资源 + /api 路由。零框架依赖。 */
import { createServer } from 'node:http';
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

ensureBootstrapAdmin();
ensureAccessUser();
syncAdminPassword();
const { syncPromptBuiltins } = await import('./promptrev.js');
syncPromptBuiltins();

// 每次模型调用落一条用量记录，供管理后台统计
setUsageSink((e) => {
  try { Usage.record(e); } catch (err) { console.warn('[usage]', err.message); }
});

const PUBLIC_DIR = fromRoot('public');
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
  ['PUT', /^\/api\/personas\/(?<id>\d+)$/, R.handlePersonaUpdate],
  ['DELETE', /^\/api\/personas\/(?<id>\d+)$/, R.handlePersonaDelete],
  ['GET', /^\/api\/personas\/(?<id>\d+)\/sections$/, R.handleSectionList],
  ['POST', /^\/api\/personas\/(?<id>\d+)\/sections$/, R.handleSectionCreate],
  ['PUT', /^\/api\/personas\/(?<id>\d+)\/sections\/(?<sectionId>\d+)$/, R.handleSectionUpdate],
  ['DELETE', /^\/api\/personas\/(?<id>\d+)\/sections\/(?<sectionId>\d+)$/, R.handleSectionDelete],
  ['GET', /^\/api\/personas\/(?<id>\d+)\/samples$/, R.handleSampleList],
  ['POST', /^\/api\/personas\/(?<id>\d+)\/samples$/, R.handleSampleCreate],
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
  ['POST', /^\/api\/frameworks$/, R.handleFrameworkCreate],
  ['PUT', /^\/api\/frameworks\/(?<fid>\d+)$/, R.handleFrameworkUpdate],
  ['DELETE', /^\/api\/frameworks\/(?<fid>\d+)$/, R.handleFrameworkDelete],
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

const server = createServer(async (req, res) => {
  attachSecurity(res);
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const path = url.pathname;

  if (path === '/health' || path === '/api/health') {
    const info = providerInfo();
    R.json(res, 200, { ok: true, app: 'copywriter-studio', llm: info.label, live: info.live });
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
        else await R.handleSpeakCreate(req, res, file, params);
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
    await serveStatic((accessGateOn() || currentUser(req)) ? '/index.html' : '/landing.html', res);
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
});

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
  const user = currentUser(req);
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

  const rel = normalize(path === '/' ? '/index.html' : path).replace(/^(\.\.[/\\])+/, '');
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
    try {
      const html = await readFile(join(PUBLIC_DIR, 'index.html'));
      res.writeHead(200, { 'Content-Type': MIME['.html'] });
      res.end(html);
    } catch {
      res.writeHead(404).end('Not Found');
    }
  }
}

server.listen(PORT, HOST, () => {
  const info = providerInfo();
  const where = HOST === '0.0.0.0' ? `http://localhost:${PORT}` : `http://${HOST}:${PORT}`;
  console.log(`\n  文案工坊 已启动  →  ${where}`);
  console.log(`  模型通道：${info.label}${info.live ? `（${info.model}）` : ' —— 复制 .env.example 为 .env 并填入密钥即可接入真实模型'}\n`);
});
