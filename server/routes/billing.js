/* 路由 · billing：套餐、额度、下单与支付回调。从原 routes.js 原样拆出。 */
import { Orders, Quota, Usage } from '../db.js';
import { HttpError } from '../auth.js';
import { snapshot } from '../quota.js';
import { creditsFor, explain, PACKS, planOf, PLANS } from '../plans.js';
import { createPayment, newTradeNo, payInfo, queryOrder, verifyNotify } from '../pay.js';
import { describe, json, requireUser } from './common.js';

/* ==================================================================
 * 套餐与用量（面向用户）
 * ================================================================== */

export async function handlePlanInfo(req, res) {
  const user = await requireUser(req);
  const q = await snapshot(user.id);

  // 本周期花在哪了。折算成点数——用户理解的是点，不是 token 和字符
  const rows = (await Usage.myUsage(user.id, q.period)).map((r) => {
    const units = r.unit === 'token' ? r.tokens : r.units;
    return {
      feature: r.feature,
      calls: r.calls,
      units: Math.round(units || 0),
      unit: r.unit || '次',
      credits: creditsFor(r.feature, units || 0),
    };
  }).filter((r) => r.credits > 0).sort((a, b) => b.credits - a.credits);

  json(res, 200, {
    quota: q,
    breakdown: rows,
    explain: explain(q.left, planOf(q.plan)),
    plans: Object.values(PLANS).map((p) => ({
      key: p.key, label: p.label, price: p.price, credits: p.credits, note: p.note, blocked: p.blocked,
    })),
    packs: Object.values(PACKS),
  });
}

/* 换套餐 / 买加购包。
 *
 * **这里还没有接支付**——现在是直接改状态。上线前必须换成"下单 → 支付回调 → 再改状态"，
 * 否则任何人都能把自己改成 Max。留成独立接口就是为了到时候只换这一处的实现。 */
export async function handlePlanChange(req, res, body) {
  const user = await requireUser(req);
  if (process.env.ALLOW_SELF_UPGRADE !== '1') {
    throw new HttpError(403, '还没接支付，暂时不能自助改套餐');
  }
  if (body?.pack) {
    const pack = PACKS[body.pack];
    if (!pack) throw new HttpError(400, '没有这个加购包');
    await Quota.addPack(user.id, pack.credits);
  } else {
    if (!PLANS[body?.plan]) throw new HttpError(400, '没有这个套餐');
    await Quota.setPlan(user.id, body.plan);
  }
  json(res, 200, { quota: await snapshot(user.id) });
}

/* ==================================================================
 * 下单与支付回调
 *
 * 几条错了就会丢钱的规则，都落在代码里：
 *   1. **订单是唯一真相**：用户套餐由订单驱动，回调只负责把订单标成已付，
 *      开通是"订单变成 paid"的副作用。不允许回调直接改用户套餐。
 *   2. **金额从服务端算**：前端只传买什么，价格查表得来。信任前端传的金额 = 一分钱买 Max。
 *   3. **发货幂等**：回调会重复推送（微信最多 15 次），靠 markPaid 的
 *      `WHERE status='pending'` 去重——第二次 changes 为 0 就跳过发货。
 *   4. **验签失败一律丢弃**：不验签等于任何人都能伪造"支付成功"。
 * ================================================================== */

export async function handlePayInfo(req, res) {
  const user = await requireUser(req);
  json(res, 200, { pay: payInfo(), orders: await Orders.listByUser(user.id, 10) });
}

export async function handleOrderCreate(req, res, body) {
  const user = await requireUser(req);
  const channel = ['wechat', 'alipay'].includes(body?.channel) ? body.channel : 'mock';

  // 价格一律从服务端的表里查——信任前端传来的金额，等于一分钱买 Max
  const kind = body?.pack ? 'pack' : 'plan';
  const item = kind === 'pack' ? PACKS[body.pack] : PLANS[body.plan];
  if (!item) throw new HttpError(400, '没有这个商品');
  if (!item.price) throw new HttpError(400, '免费档不用下单');

  const no = newTradeNo();
  const amount = Math.round(item.price * 100);      // 分。用整数，浮点算钱迟早出事
  await Orders.create({ no, userId: user.id, kind, sku: item.key, amount, channel: payInfo().provider === 'mock' ? 'mock' : channel });

  let pay;
  try {
    pay = await createPayment({ channel, no, amount, subject: `文案工坊 · ${item.label}` });
  } catch (err) {
    await Orders.close(no);
    throw new HttpError(502, `下单失败：${describe(err)}`);
  }
  json(res, 200, { no, amount, label: item.label, ...pay });
}

/* 回调。两家的响应格式不同，但逻辑是同一套。 */
export async function handlePayNotify(req, res, body, params, url) {
  const channel = String(params.channel);
  const raw = await readRawBody(req);
  const hit = verifyNotify(channel, { headers: req.headers, rawBody: raw, query: url?.searchParams });

  // 验签不过 = 伪造，直接丢。不回 200，免得对方以为收下了
  if (!hit) { res.writeHead(400).end('bad sign'); return; }

  const order = await Orders.byNo(hit.no);
  // 金额不符也当伪造——回调里的数字不可信，必须和自己落的库比
  if (!order || (hit.amount != null && Number(hit.amount) !== order.amount)) {
    res.writeHead(400).end('mismatch');
    return;
  }

  // markPaid 只在 pending 时命中；重复推送第二次就走不进发货
  if (await Orders.markPaid(hit.no, hit.tradeNo, hit.raw)) await grant(order);

  // 两家都认这种"收到了别再推了"的响应
  if (channel === 'alipay') { res.writeHead(200).end('success'); return; }
  res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"code":"SUCCESS"}');
}

/* 发货：按订单类型开通。单独一个函数，因为它必须只被 markPaid 成功后调用。 */
async function grant(order) {
  if (order.kind === 'pack') {
    const pack = PACKS[order.sku];
    if (pack) await Quota.addPack(order.user_id, pack.credits);
  } else if (PLANS[order.sku]) {
    await Quota.setPlan(order.user_id, order.sku);
  }
  await Orders.markGranted(order.out_trade_no);
}

/* 前端轮询订单状态。回调可能丢，所以这里也是补偿的入口。 */
export async function handleOrderStatus(req, res, body, params) {
  const user = await requireUser(req);
  const order = await Orders.byNo(String(params.no));
  if (!order || order.user_id !== user.id) throw new HttpError(404, '订单不存在');

  // 还没收到回调时主动查一次——不能只等推送
  if (order.status === 'pending') {
    try {
      const q = await queryOrder(order.channel, order.out_trade_no);
      if (q?.paid && await Orders.markPaid(order.out_trade_no, q.tradeNo || '', 'query')) {
        await grant(order);
      }
    } catch { /* 查单失败不影响返回当前状态 */ }
  }
  json(res, 200, { order: await Orders.byNo(order.out_trade_no), quota: await snapshot(user.id) });
}

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > 512 * 1024) { reject(new Error('回调体过大')); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/* 落地页要显示价格，但它是公开页面——不能要求登录。
   只回价格，不回任何用户数据。 */
export async function handlePricing(req, res) {
  json(res, 200, {
    plans: Object.values(PLANS).map((p) => ({
      key: p.key, label: p.label, price: p.price, credits: p.credits, note: p.note,
    })),
    packs: Object.values(PACKS).map((p) => ({
      key: p.key, label: p.label, price: p.price, credits: p.credits, pack: true,
      note: '不随月度清零。',
    })),
  });
}
