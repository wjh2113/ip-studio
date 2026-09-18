/* 进程内限流。托管密钥的公网站点没有这一层，注册和登录会被刷爆。
   单机够用：这套部署就是一台 Node + SQLite。 */
import { HttpError } from './auth.js';

const buckets = new Map();

export function clientIp(req) {
  if (process.env.TRUST_PROXY === '1') {
    const xff = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (xff) return xff;
    const real = String(req.headers['x-real-ip'] || '').trim();
    if (real) return real;
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
  if (path === '/health' || path === '/api/health') return;
  if (path.startsWith('/api/pay/notify/')) return;

  const ip = clientIp(req);
  hit(`all:${ip}`, 240, 60_000);

  if (path === '/api/auth/register') hit(`reg:${ip}`, 8, 3600_000);
  else if (path === '/api/auth/login' || path === '/api/admin/login') hit(`login:${ip}`, 30, 900_000);
  else if (path === '/api/admin/setup') hit(`setup:${ip}`, 5, 3600_000);
  else if (req.method === 'POST' && path.startsWith('/api/')) hit(`post:${ip}`, 90, 60_000);
}

setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) {
    if (now - b.start > 3600_000) buckets.delete(k);
  }
}, 10 * 60 * 1000).unref();
