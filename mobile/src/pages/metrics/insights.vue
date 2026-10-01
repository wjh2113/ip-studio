<template>
  <view class="page ins">
    <!-- 复盘（只读）：样本不够就老实说不够，不瞎总结。手机上快速瞄一眼，没有复杂筛选 -->
    <view v-if="!r && !error" class="wrap"><view v-for="i in 3" :key="i" class="skel" style="height: 200rpx; margin-bottom: 20rpx"></view></view>
    <view v-else-if="error" class="empty">{{ error }}</view>
    <template v-else>
      <view class="card head">
        <view class="big">{{ r.total }}</view><view class="hint">篇已回填</view>
        <view v-if="r.note" class="note">{{ r.note }}</view>
      </view>
      <view v-if="r.total < 3" class="card honest">
        <Ic name="info" :size="36" color="#2f6bff" />
        <view>样本还太少，看不出哪种写法更好。多回填几篇（最好都填到发布后第 7 天），这里才说得出东西。</view>
      </view>
      <view v-for="g in groups" :key="g.title" class="card">
        <view class="card-h"><text class="card-t">{{ g.title }}</text><text class="card-sub">{{ g.hint }}</text></view>
        <view v-for="row in g.rows" :key="row.name" class="g-row">
          <text class="grow ellipsis">{{ row.name }}</text>
          <text class="faint">{{ row.count }} 篇</text>
          <text class="g-v">{{ row.views7 ?? row.views ?? '样本不足' }}</text>
        </view>
        <view v-if="!g.rows.length" class="hint">还没有可分组的数据</view>
        <view v-if="g.rows.length" class="faint s">数字是阅读中位数（有第 7 天数据就用第 7 天）</view>
      </view>
      <view class="card">
        <view class="card-h"><text class="card-t">明细</text><text class="card-sub">最近 40 篇</text></view>
        <view v-for="(x, i) in r.items" :key="i" class="it">
          <view class="ellipsis it-t">{{ x.title }}</view>
          <view class="faint s">{{ session.platformLabel(x.platform) }} · {{ x.published_at || '未填发布日' }} · 阅读 {{ x.metrics?.views ?? '—' }} · 赞 {{ x.metrics?.likes ?? '—' }}</view>
        </view>
      </view>
    </template>
  </view>
</template>

<script setup>
import { computed, ref } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import Ic from '../../components/Ic.vue';
import { api } from '../../lib/api.js';
import { useAccountStore } from '../../stores/account.js';
import { useSessionStore } from '../../stores/session.js';

const acc = useAccountStore();
const session = useSessionStore();
const r = ref(null);
const error = ref('');

const groups = computed(() => (r.value ? [
  { title: '方向类型', rows: r.value.byLabel || [], hint: '哪类方向更吃香' },
  { title: '栏目', rows: r.value.bySection || [], hint: '哪个栏目的读者最买账' },
  { title: '平台', rows: r.value.byPlatform || [], hint: '同一篇不同平台差很多' },
] : []));

onLoad(async () => {
  try { r.value = await api(`/insights${acc.currentId ? `?persona=${acc.currentId}` : ''}`); } catch (err) { error.value = err.message; }
});
</script>

<style lang="scss" scoped>
.ins { padding-top: 20rpx; }
.head { text-align: center; }
.big { font-size: 80rpx; font-weight: 800; color: var(--accent-ink); }
.note { font-size: 24rpx; color: var(--muted); margin-top: 12rpx; text-align: left; line-height: 1.7; }
.honest { display: flex; gap: 16rpx; background: var(--accent-soft); color: var(--accent-ink); font-size: 26rpx; line-height: 1.7; }
.g-row { display: flex; align-items: center; gap: 16rpx; padding: 16rpx 0; border-top: 2rpx solid var(--border); font-size: 28rpx; }
.g-v { width: 140rpx; text-align: right; font-weight: 600; }
.s { font-size: 22rpx; margin-top: 8rpx; }
.it { padding: 16rpx 0; border-top: 2rpx solid var(--border); }
.it-t { font-size: 28rpx; }
</style>
