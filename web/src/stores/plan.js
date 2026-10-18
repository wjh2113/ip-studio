/* 用量与套餐：顶栏余额、用量面板、下单与支付。
 *
 * 顶栏常驻余额，撞到 402 之前就该知道快没了。面板要说清三件事：还剩多少、花在哪了、升级能多什么。
 * 支付是扫码 + 轮询订单状态：回调可能丢（网络、我们这边宕一下），不能只等推送——
 * 前端每 3 秒问一次，服务端在被问到时也会主动查单补偿。 */
import { defineStore } from 'pinia';
import { ref } from 'vue';
import { api } from '../lib/api.js';
import { on } from '../lib/bus.js';
import { toast } from '../lib/feedback.js';
import { useStudioStore } from './studio.js';

export const usePlanStore = defineStore('plan', () => {
  const data = ref(null);          // /api/plan：{ quota, explain, breakdown, plans }
  const quota = ref(null);         // 顶栏余额
  const show = ref(false);
  const focus = ref(false);        // 撞到额度上限弹出来时，滚到套餐那里

  let loading = null;
  let refreshAgain = false;
  function load() {
    if (loading) { refreshAgain = true; return loading; }
    loading = (async () => {
      do {
        refreshAgain = false;
        try {
          const next = await api('/plan');
          data.value = next;
          quota.value = next.quota;
        } catch { /* 拿不到就不显示，不影响别的 */ }
      } while (refreshAgain);
    })().finally(() => { loading = null; });
    return loading;
  }

  async function open(toPlans = false) {
    focus.value = toPlans;
    show.value = true;
    closePay();          // 重新打开面板 = 重新选套餐，之前没付完的单不再盯
    await load();
  }

  /* ---------- 支付 ---------- */
  const pay = ref(null);           // { title, kind, sku, order, qr, hint, error, waiting, timeout }
  const payInfo = ref(null);       // /api/pay：{ live, channels }
  const channel = ref('wechat');
  let timer = 0;
  let payVersion = 0;

  function closePay() {
    clearTimeout(timer);
    payVersion += 1;
    timer = 0;
    pay.value = null;
  }

  /* 点套餐 = 下单。开通是「订单支付成功」的副作用，不在这里直接改状态 */
  async function startPay(kind, sku, label) {
    closePay();
    const version = payVersion;
    const selectedChannel = channel.value;
    pay.value = { title: `购买 ${label}`, kind, sku, label, order: null, error: '', waiting: true, timeout: false };
    try {
      if (!payInfo.value) payInfo.value = (await api('/pay')).pay;
      if (version !== payVersion) return;
      const o = await api('/pay/order', {
        method: 'POST', body: { [kind === 'pack' ? 'pack' : 'plan']: sku, channel: selectedChannel },
      });
      if (version !== payVersion) return;
      pay.value.order = o;
      watchOrder(o.no, version);
    } catch (err) {
      if (version === payVersion && pay.value) { pay.value.error = err.message; pay.value.waiting = false; }
    }
  }

  function pickChannel(key) {
    channel.value = key;
    const p = pay.value;
    if (p) startPay(p.kind, p.sku, p.label);
  }

  /* 演示模式没有真二维码：点一下把回调打过去，走的是和真实回调完全同一条服务端路径（验签、幂等都在） */
  async function mockPaid() {
    const o = pay.value?.order;
    if (!o) return;
    await fetch(`/api/pay/notify/mock?no=${encodeURIComponent(o.no)}&amount=${o.amount}&token=${encodeURIComponent(o.mockToken)}`,
      { method: 'POST', body: '' });
  }

  /* 轮询：3 秒一次，5 分钟不成就停——一直转下去只会白耗请求 */
  function watchOrder(no, version) {
    const deadline = Date.now() + 5 * 60_000;
    async function poll() {
      if (version !== payVersion) return;
      if (Date.now() >= deadline) {
        if (pay.value) { pay.value.waiting = false; pay.value.timeout = true; }
        return;
      }
      try {
        const { order, quota: q } = await api(`/pay/order/${no}`);
        if (version !== payVersion) return;
        if (order.status === 'granted' || order.status === 'paid') {
          quota.value = q;
          await open();
          toast('支付成功，已开通');
          return;
        }
      } catch { /* 网络抖一下不算失败，下次再问 */ }
      if (version === payVersion) timer = setTimeout(poll, 3000);
    }
    timer = setTimeout(poll, 3000);
  }

  /* 关上面板时订单还在盯：付完了会自动开通、重新打开面板告诉他 */
  function close() {
    show.value = false;
  }

  // 花过点数就刷新余额；撞到 402 把面板顶出来——这一刻正是最愿意付费的时候，得把选项摆在面前
  let refreshTimer = 0;
  on('spent', () => {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => { if (useStudioStore().user) void load(); }, 250);
  });
  on('quota', (d) => {
    toast(d?.message || '额度不够了');
    open(true);
  });

  return {
    data, quota, show, focus, load, open, close,
    pay, payInfo, channel, startPay, pickChannel, closePay, mockPaid,
  };
});
