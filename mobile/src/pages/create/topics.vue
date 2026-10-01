<template>
  <view class="page">
    <StepBar :step="2" />
    <!-- 第二步：三个方向。点卡片选中，底部「用这个写」才开始成稿（成稿要几十秒，避免误触） -->
    <view class="intro"><Ic name="sparkles" :size="30" color="#2f6bff" /><view><view class="intro-t">基于你的选题，出了 3 个方向</view><view class="hint">每个方向都有标签、标题、差异点和结构</view></view></view>

    <view v-if="!draft" class="wrap"><view v-for="i in 3" :key="i" class="skel" style="height: 260rpx; margin-bottom: 20rpx"></view></view>
    <view v-for="(t, i) in draft?.topics || []" :key="i" class="topic" :class="[{ on: pick === i }, `t${i}`]" @tap="pick = i">
      <view class="tp-top">
        <view class="radio"><Ic v-if="pick === i" name="check" :size="22" color="#ffffff" :stroke="3" /></view>
        <text class="tag">{{ t.label || `方向 ${i + 1}` }}</text>
        <text v-if="draft.chosen === i" class="chip ok">已写过</text>
      </view>
      <view class="tp-title">{{ t.title }}</view>
      <view class="tp-row"><text class="tp-k">差异</text><text class="tp-v">{{ t.angle }}</text></view>
      <view class="tp-row"><text class="tp-k">结构</text><text class="tp-v">{{ (t.outline || []).map((o, k) => `${'①②③④⑤⑥⑦⑧'[k] || '·'} ${o}`).join('  ') }}</text></view>
    </view>
    <view class="regen" @tap="retopics"><Ic name="refresh" :size="28" color="#667085" />换一批方向</view>

    <view class="footer-pad"></view>
    <view class="footer">
      <button class="btn primary lg block" :disabled="busy || pick < 0" :loading="busy" @tap="write"><Ic name="pen" :size="32" color="#ffffff" />{{ busy ? '正在成稿…' : '用这个写' }}</button>
    </view>

    <!-- 成稿要几十秒：盖一层，告诉他在干什么，可以先去做别的 -->
    <view v-if="busy" class="busy-mask">
      <view class="busy-card">
        <view class="spinner"></view>
        <view class="busy-t">正在按「{{ draft?.topics?.[pick]?.label }}」写成稿</view>
        <view class="hint">一般 20～60 秒。可以先切到别的页面，写好了在「今天 · 今日可发」里能找到。</view>
      </view>
    </view>
  </view>
</template>

<script setup>
import { ref } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import StepBar from '../../components/StepBar.vue';
import Ic from '../../components/Ic.vue';
import { api, streamAll } from '../../lib/api.js';
import { confirm, swap, toast } from '../../lib/ui.js';

const draft = ref(null);
const pick = ref(-1);
const busy = ref(false);
let id = 0;

onLoad(async (q) => {
  id = Number(q.id);
  try {
    draft.value = (await api(`/drafts/${id}`)).draft;
    pick.value = draft.value.chosen ?? -1;
  } catch (err) { toast(err.message); }
});

async function retopics() {
  if (busy.value) return;
  if (draft.value?.content && !(await confirm({ title: '换一批方向？', content: '已经写好的正文会留在历史版本里。' }))) return;
  uni.showLoading({ title: '重新拆题材…' });
  try {
    draft.value = (await api(`/drafts/${id}/topics`, { method: 'POST', body: {} })).draft;
    pick.value = -1;
  } catch (err) { toast(err.message); } finally { uni.hideLoading(); }
}

async function write() {
  if (pick.value < 0 || busy.value) return;
  busy.value = true;
  try {
    const events = await streamAll(`/drafts/${id}/content`, { index: pick.value });
    const done = events.find((e) => e.event === 'done');
    if (!done) throw new Error('成稿没有写完，稍后在今天页里看看');
    swap('create/draft', { id });
  } catch (err) {
    toast(err.message);
  } finally {
    busy.value = false;
  }
}
</script>

<style lang="scss" scoped>
.intro { display: flex; gap: 16rpx; margin: 0 28rpx 24rpx; padding: 24rpx; border-radius: 20rpx; background: var(--accent-soft); }
.intro-t { font-size: 28rpx; font-weight: 600; }
.topic { margin: 0 28rpx 20rpx; padding: 28rpx; border-radius: 24rpx; background: var(--panel); border: 3rpx solid transparent; }
.topic.on { border-color: var(--accent); box-shadow: 0 12rpx 32rpx -18rpx rgba(47, 107, 255, .6); }
.tp-top { display: flex; align-items: center; gap: 14rpx; }
.radio { width: 40rpx; height: 40rpx; border-radius: 50%; border: 3rpx solid var(--line-strong); display: flex; align-items: center; justify-content: center; }
.topic.on .radio { background: var(--accent); border-color: var(--accent); }
.tag { font-size: 22rpx; padding: 4rpx 14rpx; border-radius: 8rpx; background: var(--accent-soft); color: var(--accent-ink); }
.t1 .tag { background: var(--violet-soft); color: #6142e6; }
.t2 .tag { background: var(--teal-soft); color: #0c8a63; }
.tp-title { font-size: 32rpx; font-weight: 700; line-height: 1.5; margin: 18rpx 0 14rpx; }
.tp-row { display: flex; gap: 16rpx; font-size: 24rpx; line-height: 1.6; margin-top: 8rpx; }
.tp-k { flex: none; color: var(--muted); }
.tp-v { color: var(--text); }
.regen { display: flex; align-items: center; justify-content: center; gap: 8rpx; font-size: 26rpx; color: var(--muted); padding: 20rpx; }
.busy-mask { position: fixed; inset: 0; z-index: 100; background: rgba(17, 24, 39, .45); display: flex; align-items: center; justify-content: center; padding: 60rpx; }
.busy-card { background: var(--panel); border-radius: 28rpx; padding: 48rpx 40rpx; text-align: center; }
.busy-t { font-size: 30rpx; font-weight: 600; margin: 24rpx 0 12rpx; }
.spinner { width: 64rpx; height: 64rpx; margin: 0 auto; border-radius: 50%; border: 6rpx solid var(--accent-soft); border-top-color: var(--accent); animation: spin .8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
</style>
