import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createSign, createCipheriv, randomBytes } from 'node:crypto';

// 用临时生成的密钥模拟商户和渠道；不连真实支付接口（fetch 被替换）
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const priv = privateKey.export({ type: 'pkcs8', format: 'pem' });
const pub = publicKey.export({ type: 'spki', format: 'pem' });
const v3key = randomBytes(16).toString('hex');
Object.assign(process.env, {
  WX_MCHID: '1900000001', WX_APPID: 'wxtest', WX_CERT_SERIAL: 'SERIAL', WX_API_V3_KEY: v3key, WX_PRIVATE_KEY: priv,
  ALI_APP_ID: '2021000', ALI_PRIVATE_KEY: priv, ALI_PUBLIC_KEY: pub, PAY_NOTIFY_BASE: 'https://pay.test',
});
const pay = await import('../server/pay.js');
const realFetch = globalThis.fetch;

test('生产环境不认演示支付：下单拒绝、回调返回 null', async () => {
  process.env.PAY_PROVIDER = 'mock';
  process.env.NODE_ENV = 'production';
  try {
    await assert.rejects(pay.createPayment({ channel: 'wechat', no: 'N1', amount: 4900, subject: 's' }));
    assert.equal(pay.verifyNotify('mock', { query: new URLSearchParams({ no: 'N1', amount: '4900', token: 'x' }) }), null);
  } finally {
    process.env.NODE_ENV = 'test';
  }
});

test('开发环境演示支付：签名对才认', async () => {
  process.env.PAY_PROVIDER = 'mock';
  const out = await pay.createPayment({ channel: 'wechat', no: 'N9', amount: 4900, subject: 's' });
  const q = (token) => new URLSearchParams({ no: 'N9', amount: '4900', token });
  assert.equal(pay.verifyNotify('mock', { query: q(out.mockToken) }).no, 'N9');
  assert.equal(pay.verifyNotify('mock', { query: q('forged') }), null);
});

test('微信下单：请求带 v3 签名头', async () => {
  process.env.PAY_PROVIDER = 'wechat';
  let auth = '';
  globalThis.fetch = async (_u, init) => { auth = init.headers.Authorization; return new Response('{"code_url":"weixin://ok"}'); };
  try {
    const out = await pay.createPayment({ channel: 'wechat', no: 'N2', amount: 4900, subject: 's' });
    assert.equal(out.codeUrl, 'weixin://ok');
    assert.match(auth, /^WECHATPAY2-SHA256-RSA2048 mchid="1900000001"/);
  } finally { globalThis.fetch = realFetch; }
});

test('微信回调：AES-GCM 解密成功；密文被改则拒绝', async () => {
  process.env.PAY_PROVIDER = 'wechat';
  const nonce = 'abcdefghijkl'; const aad = 'transaction';
  const plain = JSON.stringify({ out_trade_no: 'N2', transaction_id: 'T2', trade_state: 'SUCCESS', amount: { total: 4900 } });
  const ci = createCipheriv('aes-256-gcm', v3key, nonce); ci.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([ci.update(plain, 'utf8'), ci.final(), ci.getAuthTag()]).toString('base64');
  const body = (c) => JSON.stringify({ resource: { nonce, associated_data: aad, ciphertext: c } });
  assert.deepEqual(
    (({ no, tradeNo, amount }) => ({ no, tradeNo, amount }))(pay.verifyNotify('wechat', { headers: {}, rawBody: body(ct) })),
    { no: 'N2', tradeNo: 'T2', amount: 4900 },
  );
  const bad = Buffer.from(ct, 'base64'); bad[0] ^= 1;
  assert.equal(pay.verifyNotify('wechat', { headers: {}, rawBody: body(bad.toString('base64')) }), null);
});

test('支付宝回调：RSA2 验签；金额被改则拒绝', async () => {
  process.env.PAY_PROVIDER = 'alipay';
  const p = { out_trade_no: 'N3', trade_no: 'T3', total_amount: '49.00', trade_status: 'TRADE_SUCCESS', app_id: '2021000' };
  const base = Object.keys(p).sort().map((k) => `${k}=${p[k]}`).join('&');
  const sign = createSign('RSA-SHA256').update(base, 'utf8').end().sign(priv, 'base64');
  const ok = pay.verifyNotify('alipay', { rawBody: new URLSearchParams({ ...p, sign, sign_type: 'RSA2' }).toString() });
  assert.equal(ok.amount, 4900);
  const bad = new URLSearchParams({ ...p, total_amount: '0.01', sign, sign_type: 'RSA2' }).toString();
  assert.equal(pay.verifyNotify('alipay', { rawBody: bad }), null);
});

test('支付宝下单：请求体带签名', async () => {
  process.env.PAY_PROVIDER = 'alipay';
  let body = '';
  globalThis.fetch = async (_u, init) => { body = String(init.body); return new Response(JSON.stringify({ alipay_trade_precreate_response: { code: '10000', qr_code: 'https://qr/ok' } })); };
  try {
    const out = await pay.createPayment({ channel: 'alipay', no: 'N4', amount: 4900, subject: 's' });
    assert.equal(out.codeUrl, 'https://qr/ok');
    assert.match(body, /sign=/);
  } finally { globalThis.fetch = realFetch; }
});
