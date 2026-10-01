<template>
  <view class="page rv">
    <!-- 审稿卡堆：一条建议一张卡。右滑接受、左滑跳过、点「稍后」进今天的待办。单手横滑，地铁上也能过 -->
    <view v-if="loading" class="wrap"><view class="skel" style="height: 560rpx"></view><view class="hint center">正在通读全文，查错字、通顺、调性和风险…</view></view>
    <view v-else-if="error" class="empty">{{ error }}<view><button class="btn small" style="margin-top: 20rpx" @tap="run">重试</button></view></view>
    <template v-else>
      <view class="rv-h">
        <text class="chip" :class="verdictCls">{{ verdictText }}</text>
        <text v-if="res?.risk && res.risk !== '无'" class="chip" :class="res.risk === '高' ? 'bad' : 'warn'">风险 {{ res.risk }}</text>
        <view class="grow"></view>
        <text class="faint">{{ Math.min(idx + 1, cards.length) }} / {{ cards.length }}</text>
      </view>
      <view v-if="res?.summary" class="hint wrap">{{ res.summary }}</view>

      <view class="stack">
        <view v-if="idx >= cards.length" class="done">
          <Ic name="check-circle" :size="96" color="#16a34a" />
          <view class="done-t">{{ cards.length ? '都过完了' : '没发现要改的' }}</view>
          <view class="hint">接受 {{ stat.ok }} · 跳过 {{ stat.skip }} · 稍后 {{ stat.later }}</view>
          <button class="btn primary" style="margin-top: 30rpx" @tap="back()">回到成稿</button>
        </view>
        <view v-for="(c, i) in visible" :key="c.key" class="rcard" :class="[c.kind, `l-${c.level}`]"
          :style="i === 0 ? { transform: `translateX(${dx}px) rotate(${dx / 30}deg)`, transition: dragging ? 'none' : 'transform .25s' } : { transform: `scale(${1 - i * 0.04}) translateY(${i * 14}px)` }"
          @touchstart="i === 0 && start($event)" @touchmove="i === 0 && drag($event)" @touchend="i === 0 && end()">
          <view class="rc-top"><text class="chip" :class="c.kind === 'flag' ? (c.level === '高' ? 'bad' : 'warn') : 'gray'">{{ c.tag }}</text><text v-if="c.level" class="faint">风险 {{ c.level }}</text></view>
          <view class="rc-q">「{{ c.quote }}」</view>
          <view class="rc-why">{{ c.why }}</view>
          <view v-if="c.fix" class="rc-fix"><text class="faint">改成</text>{{ c.fix }}</view>
          <view v-if="i === 0 && dx > 40" class="stamp ok">接受</view>
          <view v-if="i === 0 && dx < -40" class="stamp skip">跳过</view>
        </view>
      </view>

      <view v-if="idx < cards.length" class="acts">
        <view class="a skip" @tap="act('skip')"><Ic name="x" :size="44" color="#667085" /><text>跳过</text></view>
        <view class="a later" @tap="act('later')"><Ic name="clock" :size="40" color="#c76a00" /><text>稍后</text></view>
        <view class="a ok" @tap="act('ok')"><Ic name="check" :size="44" color="#ffffff" :stroke="2.6" /><text>{{ cur?.fix ? '接受' : '知道了' }}</text></view>
      </view>
      <view v-if="history.length" class="undo" @tap="undo"><Ic name="undo" :size="28" color="#2f6bff" />撤销上一步</view>
    </template>
  </view>
</template>

<script setup>
import { computed, reactive, ref } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import Ic from '../../components/Ic.vue';
import { api } from '../../lib/api.js';
import { back, toast } from '../../lib/ui.js';
import { addLater, dropLater } from '../../lib/later.js';

const VERDICT = { ok: '没发现问题', minor: '有几处小毛病', bad: '大面积不通顺' };

const draft = ref(null);
const res = ref(null);
const loading = ref(true);
const error = ref('');
const idx = ref(0);
const dx = ref(0);
const dragging = ref(false);
const history = ref([]);
const stat = reactive({ ok: 0, skip: 0, later: 0 });
let id = 0;
let x0 = 0;

/* 风险提示和改字建议一起排：风险在前 */
const cards = computed(() => {
  const r = res.value;
  if (!r) return [];
  const flags = (r.flags || []).map((f, i) => ({ key: `f${i}`, kind: 'flag', tag: f.dimension, level: f.level, quote: f.quote || f.what, why: f.what, fix: '', hint: f.suggestion }))
    .map((c) => ({ ...c, why: c.hint ? `${c.why}　建议：${c.hint}` : c.why }));
  const issues = (r.issues || []).map((it, i) => ({ key: `i${i}`, kind: 'issue', tag: it.type, level: '', quote: it.quote, why: it.why, fix: it.fix }));
  return [...flags, ...issues];
});
const visible = computed(() => cards.value.slice(idx.value, idx.value + 3).map((c) => c));
const cur = computed(() => cards.value[idx.value]);
const verdictText = computed(() => VERDICT[res.value?.verdict] || '检查完了');
const verdictCls = computed(() => ({ ok: 'ok', minor: '', bad: 'bad' }[res.value?.verdict] ?? ''));

onLoad(async (q) => {
  id = Number(q.id);
  try { draft.value = (await api(`/drafts/${id}`)).draft; } catch (err) { error.value = err.message; loading.value = false; return; }
  run();
});

async function run() {
  loading.value = true;
  error.value = '';
  try {
    res.value = (await api(`/drafts/${id}/review`, { method: 'POST', body: { content: draft.value.content } })).review;
    idx.value = 0;
  } catch (err) { error.value = err.message; } finally { loading.value = false; }
}

function start(e) { dragging.value = true; x0 = e.touches[0].clientX; }
function drag(e) { dx.value = e.touches[0].clientX - x0; }
function end() {
  dragging.value = false;
  if (dx.value > 90) act('ok');
  else if (dx.value < -90) act('skip');
  dx.value = 0;
}

async function act(kind) {
  const c = cur.value;
  if (!c) return;
  const before = draft.value.content;
  if (kind === 'ok' && c.fix) {
    if (!before.includes(c.quote)) { toast('原文已经改过，这条对不上了'); }
    else {
      const next = before.replace(c.quote, c.fix);
      try {
        await api(`/drafts/${id}/content`, { method: 'PUT', body: { content: next } });
        draft.value = { ...draft.value, content: next };
      } catch (err) { toast(err.message); return; }
    }
  }
  if (kind === 'later') addLater({ draftId: id, title: draft.value.title || draft.value.subject, quote: c.quote, why: c.why });
  history.value.push({ kind, card: c, before });
  stat[kind] += 1;
  idx.value += 1;
}

async function undo() {
  const h = history.value.pop();
  if (!h) return;
  if (h.kind === 'ok' && h.before !== draft.value.content) {
    try {
      await api(`/drafts/${id}/content`, { method: 'PUT', body: { content: h.before } });
      draft.value = { ...draft.value, content: h.before };
    } catch (err) { toast(err.message); return; }
  }
  if (h.kind === 'later') dropLater(id, h.card.quote);
  stat[h.kind] -= 1;
  idx.value -= 1;
}
</script>

<style lang="scss" scoped>
.rv { padding-top: 20rpx; min-height: 100vh; }
.rv-h { display: flex; align-items: center; gap: 12rpx; padding: 0 28rpx 12rpx; }
.center { text-align: center; margin-top: 20rpx; }
.stack { position: relative; height: 640rpx; margin: 24rpx 40rpx 0; }
.rcard { position: absolute; left: 0; right: 0; top: 0; min-height: 560rpx; padding: 36rpx; border-radius: 32rpx; background: var(--panel); box-shadow: 0 20rpx 50rpx -24rpx rgba(16, 24, 40, .35); }
.rcard:nth-child(2) { z-index: 3; }
.rcard:nth-child(3) { z-index: 2; }
.rcard:nth-child(4) { z-index: 1; }
.rcard.flag.l-高 { border-top: 8rpx solid var(--danger); }
.rcard.flag.l-中 { border-top: 8rpx solid #f59e0b; }
.rcard.issue { border-top: 8rpx solid var(--accent); }
.rc-top { display: flex; align-items: center; gap: 14rpx; }
.rc-q { font-size: 34rpx; font-weight: 600; line-height: 1.6; margin: 28rpx 0 20rpx; }
.rc-why { font-size: 28rpx; color: var(--muted); line-height: 1.7; }
.rc-fix { margin-top: 24rpx; padding: 20rpx; border-radius: 16rpx; background: var(--ok-soft); color: #15703a; font-size: 30rpx; line-height: 1.6; display: flex; flex-direction: column; gap: 6rpx; }
.stamp { position: absolute; top: 40rpx; padding: 8rpx 24rpx; border-radius: 12rpx; font-size: 32rpx; font-weight: 800; border: 4rpx solid; }
.stamp.ok { left: 40rpx; color: var(--ok); border-color: var(--ok); transform: rotate(-12deg); }
.stamp.skip { right: 40rpx; color: var(--muted); border-color: var(--muted); transform: rotate(12deg); }
.done { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; }
.done-t { font-size: 36rpx; font-weight: 700; margin: 20rpx 0 8rpx; }
.acts { display: flex; justify-content: center; align-items: center; gap: 60rpx; margin-top: 30rpx; }
.a { display: flex; flex-direction: column; align-items: center; gap: 8rpx; font-size: 24rpx; color: var(--muted); }
.a .ic { padding: 24rpx; border-radius: 50%; background: var(--panel); box-sizing: content-box; box-shadow: 0 8rpx 20rpx -8rpx rgba(16, 24, 40, .25); }
.a.ok .ic { background: var(--ok); }
.a.later .ic { background: var(--warn-soft); }
.undo { display: flex; align-items: center; justify-content: center; gap: 8rpx; margin-top: 30rpx; font-size: 26rpx; color: var(--accent-ink); }
</style>
