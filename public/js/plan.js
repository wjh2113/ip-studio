/* 前端 · plan：用量、套餐与支付。从原 app.js 原样拆出。 */
import { api, el, esc, state, toast } from './core.js';

/* ==================================================================
 * 用量与套餐
 *
 * 顶栏常驻余额，撞到 402 之前就该知道快没了。
 * 浮层要说清三件事：还剩多少、花在哪了、升级能多什么。
 * ================================================================== */

const plan = { data: null };

export async function loadPlan() {
  try {
    plan.data = await api('/plan');
    renderCreditChip();
  } catch { /* 拿不到就不显示，不影响别的 */ }
}

/* 顶栏余额由 Vue 渲染（web/src/components/TopBar.vue）：这里只更新数据 */
function renderCreditChip() {
  state.quota = plan.data?.quota || null;
}

el.creditChip.addEventListener('click', openPlan);

el.planClose.addEventListener('click', () => el.planModal.classList.add('hidden'));

async function openPlan(focus) {
  el.planModal.classList.remove('hidden');
  closePay();
  el.planBreakdown.innerHTML = '<div class="idea-skeleton"></div>';
  await loadPlan();
  const d = plan.data;
  if (!d) return;
  const q = d.quota;

  el.planPeriod.textContent = `${q.period} · 下月 1 号重置`;

  const pct = q.total ? Math.max(0, Math.min(100, (q.left / q.total) * 100)) : 0;
  el.planNow.innerHTML = `
    <div class="row">
      <span class="big">${q.left.toLocaleString()}</span>
      <span class="of">/ ${q.total.toLocaleString()} 点剩余</span>
      <span class="grow"></span>
      <span class="of">${esc(q.label)}${q.price ? ` · ${q.price} 元/月` : ''}</span>
    </div>
    <div class="plan-bar ${pct < 15 ? 'low' : ''}"><div style="width:${pct}%"></div></div>
    <p class="eq">${d.explain.length
    ? `还能写 <b>${d.explain.map((x) => `${x.n} ${x.what}`).join('</b>，或 <b>')}</b>（各是全部额度都用在这一项上）`
    : '额度已经用完，下月 1 号重置。'}
    </p>`;

  el.planBreakdown.innerHTML = d.breakdown.length ? d.breakdown.map((r) => `
    <div class="use-row">
      <span class="f">${esc(r.feature)}</span>
      <span class="amt">${r.calls} 次 · ${r.units.toLocaleString()} ${esc(r.unit)}</span>
      <span class="cr">${r.credits.toLocaleString()} 点</span>
    </div>`).join('') : '<p class="hint">这个月还没有消耗。</p>';

  const card = (p, isPack) => `
    <div class="plan-card ${!isPack && p.key === q.plan ? 'on' : ''}">
      <h4>${esc(p.label)}</h4>
      <div class="price">${p.price ? `${p.price}<em> 元${isPack ? '' : '/月'}</em>` : '免费'}</div>
      <div class="cr">${p.credits.toLocaleString()} 点</div>
      <p class="note">${esc(p.note || '')}</p>
      ${!isPack && p.key === q.plan
    ? '<button class="btn ghost small" disabled>当前套餐</button>'
    : `<button class="btn ${isPack ? 'ghost' : 'primary'} small"
         data-${isPack ? 'pack' : 'plan'}="${esc(p.key)}">${isPack ? '购买' : '换到这档'}</button>`}
    </div>`;

  el.planCards.innerHTML = d.plans.map((p) => card(p, false)).join('');
  el.planNote.textContent = '点数按实际消耗扣。写稿很便宜，出图是大头——明细里能看出钱花在哪。';

  if (focus) el.planModal.querySelector('.modal-body').scrollTo({ top: 260, behavior: 'smooth' });
}

/* 换套餐 / 买包。**还没接支付**——后端默认拒绝，这里如实说，不做假成功 */
/* 点套餐 = 下单，不再直接改状态。开通是"订单支付成功"的副作用。 */
el.planModal.addEventListener('click', (e) => {
  const b = e.target.closest('[data-plan]');
  if (!b) return;
  const card = b.closest('.plan-card');
  const label = card?.querySelector('h4')?.textContent || '';
  startPay('plan', b.dataset.plan, label);
});

/* 撞到 402 时把用量面板顶出来。
   普通 toast 说一句"额度不够"然后消失，人不知道该干什么——
   这一刻正是他最愿意付费的时候，得把选项摆在面前。 */
window.addEventListener('cw-spent', () => { loadPlan(); });

window.addEventListener('cw-quota', (e) => {
  toast(e.detail?.message || '额度不够了');
  openPlan(true);
});

/* ==================================================================
 * 支付
 *
 * 扫码 + **轮询订单状态**。回调可能丢（网络、我们这边宕一下），
 * 所以不能只等推送——前端每 3 秒问一次，服务端在被问到时也会主动查单补偿。
 * ================================================================== */

const pay = { info: null, order: null, timer: 0, channel: 'wechat' };

el.payCancel.addEventListener('click', closePay);

function closePay() {
  clearInterval(pay.timer);
  pay.timer = 0;
  pay.order = null;
  el.payBox.classList.add('hidden');
}

async function startPay(kind, sku, label) {
  if (!pay.info) {
    try { pay.info = (await api('/pay')).pay; } catch { toast('支付未就绪'); return; }
  }
  closePay();
  el.payBox.classList.remove('hidden');
  el.payTitle.textContent = `购买 ${label}`;
  el.payQr.textContent = '正在下单…';
  el.payHint.textContent = '';

  // 渠道按钮。没配好商户号的置灰——点了也只会失败，不如直说
  el.payChannels.innerHTML = pay.info.channels.map((c) => `
    <button type="button" data-ch="${esc(c.key)}" class="${c.key === pay.channel ? 'on' : ''}"
      ${c.ready || !pay.info.live ? '' : 'disabled title="这个渠道还没配置商户号"'}>${esc(c.label)}</button>`).join('');

  try {
    const o = await api('/pay/order', { method: 'POST',
      body: { [kind === 'pack' ? 'pack' : 'plan']: sku, channel: pay.channel } });
    pay.order = o;
    renderQr(o);
    watchOrder(o.no);
  } catch (err) {
    el.payQr.textContent = '';
    el.payHint.textContent = err.message;
  }
}

function renderQr(o) {
  if (o.mock) {
    // 演示模式没有真二维码，给一个直接点的按钮把回调打过去——
    // 走的是和真实回调**完全同一条**服务端路径，包括验签和幂等
    el.payQr.innerHTML = `<div>演示模式<br>不会真的扣款<br><br>
      <button class="btn primary small" id="mockPaid">模拟支付成功</button></div>`;
    el.payQr.querySelector('#mockPaid').addEventListener('click', async () => {
      await fetch(`/api/pay/notify/mock?no=${encodeURIComponent(o.no)}&amount=${o.amount}&token=${encodeURIComponent(o.mockToken)}`,
        { method: 'POST', body: '' });
    });
  } else {
    // 真实渠道返回的是二维码内容串，用第三方库渲染会引依赖——
    // 这里直接给链接文本 + 提示用手机扫。上线前可以换成本地生成的 SVG 二维码
    el.payQr.innerHTML = `<div style="word-break:break-all;font-size:10px">${esc(o.codeUrl || '')}</div>`;
  }
  el.payHint.innerHTML = `订单 <code>${esc(o.no)}</code> · ${(o.amount / 100).toFixed(2)} 元
    <br><span class="pay-wait">等待支付…</span>`;
}

el.payChannels.addEventListener('click', (e) => {
  const b = e.target.closest('[data-ch]');
  if (!b || b.disabled) return;
  pay.channel = b.dataset.ch;
  const o = pay.order;
  if (o) startPay(o.kind || 'plan', o.sku, el.payTitle.textContent.replace('购买 ', ''));
});

/* 轮询。3 秒一次，5 分钟不成就停——一直转下去只会白耗请求 */
function watchOrder(no) {
  let n = 0;
  pay.timer = setInterval(async () => {
    n += 1;
    if (n > 100) { clearInterval(pay.timer); el.payHint.innerHTML = '等太久了，付好了可以关掉重开这个页面。'; return; }
    try {
      const { order, quota } = await api(`/pay/order/${no}`);
      if (order.status === 'granted' || order.status === 'paid') {
        clearInterval(pay.timer);
        plan.data = { ...plan.data, quota };
        renderCreditChip();
        closePay();
        await openPlan();
        toast('支付成功，已开通');
      }
    } catch { /* 网络抖一下不算失败，下次再问 */ }
  }, 3000);
}
