/* 进程内限流。托管密钥的公网站点没有这一层，注册和登录会被刷爆。
   单机够用：这套部署就是一台 Node + PostgreSQL。 */
import { HttpError } from './auth.js';

const buckets = new Map();

/* 在 nginx 后面（TRUST_PROXY=1）时取真实客户端 IP。
   优先 X-Real-IP：nginx 用 $remote_addr 覆盖写入，客户端伪造不了。
   X-Forwarded-For 的最左一段是客户端自己能随便写的（nginx 的 $proxy_add_x_forwarded_for 只是在后面追加），
   以前取最左一段，换个请求头就能绕过注册、登录限流；退而求其次时取最右一段，即 nginx 亲眼看到的地址。 */
export function clientIp(req) {
  if (process.env.TRUST_PROXY === '1') {
    const real = String(req.headers['x-real-ip'] || '').trim();
    if (real) return real;
    const hops = String(req.headers['x-forwarded-for'] || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (hops.length) return hops[hops.length - 1];
  }
  return req.socket?.remoteAddress || 'unknown';
}

function hit(key, max, windowMs) {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || now - b.start >= windowMs) {
    b = { start: now, n: 0 };
    buckets.set(key, b);
  }
  b.n += 1;
  if (b.n > max) throw new HttpError(429, '请求过于频繁，请稍后再试');
}

export function rateLimit(req, path) {
  // 浏览器回归测试会在一分钟里从本机发几百个请求；只在非生产环境允许关掉
  if (process.env.RATE_LIMIT === 'off' && process.env.NODE_ENV !== 'production') return;
  if (path === '/health' || path === '/api/health') return;
  if (path.startsWith('/api/pay/notify/')) return;

  const ip = clientIp(req);
  hit(`all:${ip}`, 240, 60_000);

  if (path === '/api/auth/register') hit(`reg:${ip}`, 8, 3600_000);
  else if (path === '/api/auth/login' || path === '/api/admin/login') hit(`login:${ip}`, 30, 900_000);
  else if (path === '/api/admin/setup') hit(`setup:${ip}`, 5, 3600_000);
  else if (req.method === 'POST' && path.startsWith('/api/')) hit(`post:${ip}`, 90, 60_000);
}

/* 按用户限流：给「服务端替用户去访问外部网站」这类接口用（对标抓取）。不扣额度，但不能被当成免费爬虫 */
export function userLimit(userId, name, max, windowMs) {
  if (process.env.RATE_LIMIT === 'off' && process.env.NODE_ENV !== 'production') return;
  hit(`user:${name}:${userId}`, max, windowMs);
}

setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) {
    if (now - b.start > 3600_000) buckets.delete(k);
  }
}, 10 * 60 * 1000).unref();
