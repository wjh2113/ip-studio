/* 给所有响应补上基础安全头。应用自己没有框架中间件，所以在 writeHead 上包一层。 */
const HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-DNS-Prefetch-Control': 'off',
};

export function attachSecurity(res) {
  const orig = res.writeHead;
  res.writeHead = function writeHead(code, a, b) {
    const hasMsg = typeof a === 'string';
    const headers = hasMsg ? b : a;
    const merged = { ...HEADERS, ...(headers || {}) };
    return hasMsg ? orig.call(this, code, a, merged) : orig.call(this, code, merged);
  };
  return res;
}

export function isSecureCookie() {
  return process.env.COOKIE_SECURE === '1' || process.env.NODE_ENV === 'production';
}

export const cookieAttrs = () => (
  `Path=/; HttpOnly; SameSite=Lax${isSecureCookie() ? '; Secure' : ''}`
);
