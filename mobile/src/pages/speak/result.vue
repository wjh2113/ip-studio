<template>
  <view class="page res">
    <!-- 口播评测结果：总分 + 分项（没测的写「未测」不是 0）、回放、逐句标记（点一句回提词器定位）、重拍 -->
    <view v-if="ready" class="arrive"><Ic name="bell" :size="28" color="#1f56e0" />评测好了，马上能看</view>
    <view v-if="!sp" class="wrap"><view class="skel" style="height: 300rpx"></view></view>
    <template v-else>
      <view v-if="sp.status !== 'ready' && sp.status !== 'failed'" class="card">
        <view class="skel" style="height: 120rpx"></view>
        <view class="hint" style="margin-top: 20rpx">正在转写和总评…可以先去做别的，好了会提示。</view>
      </view>
      <view v-else-if="sp.status === 'failed'" class="card">
        <view class="fail-t">评估失败</view>
        <view class="hint">{{ sp.error || '没评出来' }}</view>
        <button class="btn primary" style="margin-top: 24rpx" :loading="busy" @tap="retry">重新评估</button>
      </view>
      <template v-else-if="r">
        <view class="card score-card">
          <view class="big">{{ r.score ?? '—' }}<text class="unit">分</text></view>
          <view class="dims">
            <view v-for="d in dims" :key="d.key" class="dim">
              <text class="dk">{{ d.key }}</text>
              <view class="db"><view class="dbi" :style="{ width: d.score == null ? '0' : `${d.score}%` }"></view></view>
              <text class="dv" :class="{ untested: d.score == null }">{{ d.score == null ? '未测' : d.score }}</text>
            </view>
          </view>
          <view v-if="r.next" class="next"><Ic name="bulb" :size="28" color="#c76a00" />下一遍：{{ r.next }}</view>
        </view>

        <view v-if="sp.audio" class="card">
          <view class="card-h"><text class="card-t">回放</text></view>
          <video v-if="media" :src="media" controls class="media" :class="{ vid: isVideo }" />
          <view v-else class="hint">正在取回录音…</view>
        </view>

        <view class="card">
          <view class="card-h"><text class="card-t">逐句</text><text class="card-sub">点一句，回提词器从这句开始</text></view>
          <view v-for="(c, i) in cues" :key="i" class="sent" :class="{ bad: lose(c) }" @tap="go('speak/record', { id: sp.draftId, from: i })">
            <view class="s-n">{{ i + 1 }}</view>
            <view class="grow">
              <view class="s-t">{{ c.quote }}</view>
              <view v-if="lose(c)" class="s-lift">{{ lose(c).lose ? `−${lose(c).lose} ` : '' }}{{ lose(c).do }}</view>
            </view>
          </view>
          <view v-if="!cues.length" class="hint">这一遍没有逐句提示。</view>
        </view>

        <view class="row gap wrap">
          <button class="btn grow" :disabled="checking === 'voice'" :loading="checking === 'voice'" @tap="check('voice')">{{ r.checks?.voice ? '重测发音' : '只测发音' }}</button>
          <button class="btn grow" :disabled="checking === 'video' || !isVideo" :loading="checking === 'video'" @tap="check('video')">{{ r.checks?.video ? '重测出镜' : '只测出镜' }}</button>
        </view>
      </template>
    </template>
    <view class="footer-pad"></view>
    <view v-if="sp" class="footer"><button class="btn primary lg block" @tap="go('speak/record', { id: sp.draftId })"><Ic name="video" :size="32" color="#ffffff" />重拍这一遍</button></view>
  </view>
</template>

<script setup>
import { computed, ref } from 'vue';
import { onLoad, onUnload } from '@dcloudio/uni-app';
import Ic from '../../components/Ic.vue';
import { api } from '../../lib/api.js';
import { go, toast } from '../../lib/ui.js';
import { authedImage } from '../../lib/image.js';

const DIM_KEYS = ['完整', '发音', '节奏', '表达', '出镜'];

const sp = ref(null);
const media = ref('');
const busy = ref(false);
const checking = ref('');
const ready = ref(false);
let id = 0;
let timer = 0;

const r = computed(() => sp.value?.review || null);
const isVideo = computed(() => /video/.test(sp.value?.mime || ''));
const cues = computed(() => {
  const c = sp.value?.cues;
  return Array.isArray(c) ? c : c?.cues || [];
});
/* 分项固定五个，服务端没给的就是没测 */
const dims = computed(() => DIM_KEYS.map((k) => r.value?.dims?.find((d) => d.key === k) || { key: k, score: null }));
const lose = (c) => (r.value?.lifts || []).find((l) => l.quote && (c.quote.includes(l.quote) || l.quote.includes(c.quote.slice(0, 12))));

async function load() {
  try {
    const { speak } = await api(`/speaks/${id}`);
    const was = sp.value?.status;
    sp.value = speak;
    if (was && was !== 'ready' && speak.status === 'ready') ready.value = true;
    if (speak.audio && !media.value) media.value = await authedImage(speak.audio);
    clearTimeout(timer);
    if (speak.status !== 'ready' && speak.status !== 'failed') timer = setTimeout(load, 4000);
  } catch (err) { toast(err.message); }
}
onLoad((q) => { id = Number(q.id); ready.value = q.push === '1'; load(); });
onUnload(() => clearTimeout(timer));

async function retry() {
  busy.value = true;
  try { await api(`/speaks/${id}/retry`, { method: 'POST', body: {} }); load(); } catch (err) { toast(err.message); } finally { busy.value = false; }
}

async function check(kind) {
  checking.value = kind;
  try {
    await api(`/speaks/${id}/${kind === 'video' ? 'appearance' : 'pronounce'}`, { method: 'POST', body: { async: true } });
    toast('已加入评测队列，好了会提示');
  } catch (err) { toast(err.message); } finally { checking.value = ''; }
}
</script>

<style lang="scss" scoped>
.res { padding-top: 16rpx; }
.arrive { display: flex; align-items: center; gap: 10rpx; margin: 0 28rpx 20rpx; padding: 16rpx 24rpx; border-radius: 16rpx; background: var(--accent-soft); color: var(--accent-ink); font-size: 26rpx; }
.score-card { text-align: center; }
.big { font-size: 112rpx; font-weight: 800; color: var(--accent-ink); line-height: 1.1; }
.unit { font-size: 30rpx; color: var(--muted); margin-left: 6rpx; font-weight: 500; }
.dims { margin-top: 24rpx; text-align: left; }
.dim { display: flex; align-items: center; gap: 16rpx; padding: 10rpx 0; }
.dk { width: 72rpx; font-size: 26rpx; color: var(--muted); }
.db { flex: 1; height: 14rpx; border-radius: 7rpx; background: var(--panel-2); overflow: hidden; }
.dbi { height: 100%; background: var(--accent); border-radius: 7rpx; }
.dv { width: 72rpx; text-align: right; font-size: 26rpx; font-weight: 600; }
.dv.untested { color: var(--faint); font-weight: 400; }
.next { display: flex; gap: 10rpx; text-align: left; margin-top: 24rpx; padding: 18rpx 20rpx; border-radius: 14rpx; background: var(--warn-soft); font-size: 26rpx; color: #8a4b00; line-height: 1.6; }
.media { width: 100%; height: 100rpx; }
.media.vid { height: 420rpx; border-radius: 16rpx; background: #000; }
.sent { display: flex; gap: 16rpx; padding: 18rpx 0; border-top: 2rpx solid var(--border); }
.s-n { width: 44rpx; height: 44rpx; border-radius: 50%; background: var(--panel-2); font-size: 22rpx; display: flex; align-items: center; justify-content: center; flex: none; }
.sent.bad .s-n { background: var(--danger-soft); color: var(--danger); }
.s-t { font-size: 28rpx; line-height: 1.6; }
.s-lift { font-size: 24rpx; color: var(--danger); margin-top: 6rpx; }
.fail-t { font-size: 32rpx; font-weight: 700; color: var(--danger); }
.row.gap { display: flex; gap: 20rpx; }
</style>
