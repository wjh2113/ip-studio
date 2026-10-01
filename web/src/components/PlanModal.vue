<template>
  <Modal id="planModal" v-model:open="p.show" title="用量与套餐" size="wide" close-id="planClose" sub-id="planPeriod"
    :sub="q ? `${q.period} · 下月 1 号重置` : ''" :mask-close="false" @close="p.close()">
    <div ref="body">
      <template v-if="d">
        <div class="plan-now" id="planNow">
          <div class="row">
            <span class="big">{{ q.left.toLocaleString() }}</span>
            <span class="of">/ {{ q.total.toLocaleString() }} 点剩余</span>
            <span class="grow"></span>
            <span class="of">{{ q.label }}{{ q.price ? ` · ${q.price} 元/月` : '' }}</span>
          </div>
          <div class="plan-bar" :class="{ low: pct < 15 }"><div :style="{ width: `${pct}%` }"></div></div>
          <p class="eq">
            <template v-if="d.explain.length">还能写
              <template v-for="(x, i) in d.explain" :key="i"><template v-if="i">，或 </template><b>{{ x.n }} {{ x.what }}</b></template>（各是全部额度都用在这一项上）
            </template>
            <template v-else>额度已经用完，下月 1 号重置。</template>
          </p>
        </div>
        <h3 class="plan-h">本月花在哪了</h3>
        <div id="planBreakdown">
          <div v-for="r in d.breakdown" :key="r.feature" class="use-row">
            <span class="f">{{ r.feature }}</span>
            <span class="amt">{{ r.calls }} 次 · {{ r.units.toLocaleString() }} {{ r.unit }}</span>
            <span class="cr">{{ r.credits.toLocaleString() }} 点</span>
          </div>
          <p v-if="!d.breakdown.length" class="hint">这个月还没有消耗。</p>
        </div>
        <h3 class="plan-h">套餐</h3>
        <div class="plan-cards" id="planCards">
          <div v-for="x in d.plans" :key="x.key" class="plan-card" :class="{ on: x.key === q.plan }">
            <h4>{{ x.label }}</h4>
            <div class="price"><template v-if="x.price">{{ x.price }}<em> 元/月</em></template><template v-else>免费</template></div>
            <div class="cr">{{ x.credits.toLocaleString() }} 点</div>
            <p class="note">{{ x.note || '' }}</p>
            <button v-if="x.key === q.plan" class="btn ghost small" disabled>当前套餐</button>
            <button v-else class="btn primary small" :data-plan="x.key" @click="p.startPay('plan', x.key, x.label)">换到这档</button>
          </div>
        </div>
        <p class="hint" id="planNote">点数按实际消耗扣。写稿很便宜，出图是大头——明细里能看出钱花在哪。</p>
      </template>
      <div v-else class="idea-skeleton"></div>

      <!-- 支付：扫码 + 轮询订单状态 -->
      <div v-if="pay" class="paybox" id="payBox">
        <div class="pay-head">
          <b id="payTitle">{{ pay.title }}</b>
          <span class="grow"></span>
          <button class="icon-btn" id="payCancel" title="取消" @click="p.closePay()">×</button>
        </div>
        <div class="pay-body">
          <div class="pay-qr" id="payQr">
            <template v-if="!pay.order">{{ pay.error ? '' : '正在下单…' }}</template>
            <div v-else-if="pay.order.mock">演示模式<br>不会真的扣款<br><br>
              <button class="btn primary small" id="mockPaid" @click="p.mockPaid()">模拟支付成功</button>
            </div>
            <!-- 真实渠道返回的是二维码内容串。先给链接文本让人用手机扫；上线前可以换成本地生成的二维码 -->
            <div v-else style="word-break:break-all;font-size:10px">{{ pay.order.codeUrl || '' }}</div>
          </div>
          <div class="pay-side">
            <div class="pay-ch" id="payChannels">
              <button v-for="c in p.payInfo?.channels || []" :key="c.key" type="button" :data-ch="c.key"
                :class="{ on: c.key === p.channel }" :disabled="!(c.ready || !p.payInfo.live)"
                :title="c.ready || !p.payInfo.live ? '' : '这个渠道还没配置商户号'"
                @click="p.pickChannel(c.key)">{{ c.label }}</button>
            </div>
            <p class="hint" id="payHint">
              <template v-if="pay.error">{{ pay.error }}</template>
              <template v-else-if="pay.timeout">等太久了，付好了可以关掉重开这个页面。</template>
              <template v-else-if="pay.order">订单 <code>{{ pay.order.no }}</code> · {{ (pay.order.amount / 100).toFixed(2) }} 元
                <br><span class="pay-wait">等待支付…</span></template>
            </p>
          </div>
        </div>
      </div>
    </div>
  </Modal>
</template>

<script setup>
import { computed, nextTick, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import Modal from './common/Modal.vue';
import { usePlanStore } from '../stores/plan.js';

const p = usePlanStore();
const { data: d, pay } = storeToRefs(p);
const q = computed(() => d.value?.quota || null);
const pct = computed(() => (q.value?.total ? Math.max(0, Math.min(100, (q.value.left / q.value.total) * 100)) : 0));
const body = ref(null);

// 撞到额度上限弹出来时，直接滚到套餐
watch(() => [p.show, d.value], async ([open]) => {
  if (!open || !p.focus || !d.value) return;
  await nextTick();
  body.value?.closest('.modal-body')?.scrollTo({ top: 260, behavior: 'smooth' });
  p.focus = false;
});
</script>
