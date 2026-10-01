<template>
  <view class="page tt">
    <!-- 标题候选：大热区，点一条替换标题；能直接写进发布包（发布包读的就是成稿标题） -->
    <view class="tt-h">
      <view class="tt-t">标题候选</view>
      <view class="hint">{{ limit ? `这个平台标题不超过 ${limit} 字` : '按不同写法出 6 个，挑一个替换' }}</view>
    </view>
    <view v-if="loading" class="wrap"><view v-for="i in 6" :key="i" class="skel" style="height: 120rpx; margin-bottom: 16rpx"></view></view>
    <view v-else-if="error" class="empty">{{ error }}</view>
    <view v-for="(x, i) in titles" :key="i" class="tt-i" :class="{ on: pick === i }" @tap="pick = i">
      <view class="tt-text">{{ x.text }}</view>
      <view class="tt-meta">
        <text v-if="x.type" class="chip gray">{{ x.type }}</text>
        <text :class="x.over ? 'bad' : 'faint'">{{ x.chars }} 字{{ x.over ? ' · 超限' : '' }}</text>
        <text v-if="x.risk?.length" class="bad">含「{{ x.risk.join('、') }}」注意广告法</text>
        <view class="grow"></view>
        <view class="radio"><Ic v-if="pick === i" name="check" :size="22" color="#ffffff" :stroke="3" /></view>
      </view>
    </view>
    <view class="footer-pad"></view>
    <view class="footer row gap">
      <button class="btn lg" :disabled="loading" @tap="load"><Ic name="refresh" :size="30" />换一批</button>
      <button class="btn primary lg grow" :disabled="pick < 0 || applying" :loading="applying" @tap="apply">用这个，写入发布包</button>
    </view>
  </view>
</template>

<script setup>
import { ref } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import Ic from '../../components/Ic.vue';
import { api } from '../../lib/api.js';
import { back, toast } from '../../lib/ui.js';

const titles = ref([]);
const limit = ref(0);
const loading = ref(false);
const error = ref('');
const pick = ref(-1);
const applying = ref(false);
let id = 0;

onLoad((q) => { id = Number(q.id); load(); });

async function load() {
  loading.value = true;
  error.value = '';
  pick.value = -1;
  try {
    const out = await api(`/drafts/${id}/titles`, { method: 'POST', body: {} });
    titles.value = out.titles || [];
    limit.value = out.limit || 0;
  } catch (err) { error.value = err.message; } finally { loading.value = false; }
}

async function apply() {
  const text = titles.value[pick.value]?.text;
  if (!text) return;
  applying.value = true;
  try {
    await api(`/drafts/${id}/title`, { method: 'PUT', body: { title: text } });
    toast('标题已替换', 'success');
    setTimeout(() => back(), 500);
  } catch (err) { toast(err.message); } finally { applying.value = false; }
}
</script>

<style lang="scss" scoped>
.tt { padding-top: 12rpx; }
.tt-h { padding: 0 28rpx 20rpx; }
.tt-t { font-size: 40rpx; font-weight: 800; }
.tt-i { margin: 0 28rpx 16rpx; padding: 28rpx; border-radius: 20rpx; background: var(--panel); border: 3rpx solid transparent; }
.tt-i.on { border-color: var(--accent); background: #f7faff; }
.tt-text { font-size: 32rpx; font-weight: 600; line-height: 1.5; }
.tt-meta { display: flex; align-items: center; gap: 14rpx; margin-top: 14rpx; font-size: 22rpx; }
.bad { color: var(--danger); }
.radio { width: 40rpx; height: 40rpx; border-radius: 50%; border: 3rpx solid var(--line-strong); display: flex; align-items: center; justify-content: center; }
.tt-i.on .radio { background: var(--accent); border-color: var(--accent); }
.footer.row.gap { display: flex; gap: 20rpx; }
.footer .btn.lg:first-child { flex: none; padding: 0 28rpx; }
</style>
