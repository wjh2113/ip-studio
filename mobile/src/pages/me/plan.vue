<template>
  <view class="page pl">
    <!-- 用量与套餐：手机上只看。买套餐去网页端（App 内购买要走应用商店的支付规则，第一阶段不做） -->
    <view v-if="!d" class="wrap"><view class="skel" style="height: 240rpx"></view></view>
    <template v-else>
      <view class="card now">
        <view class="faint s">{{ d.quota.label }} · {{ d.quota.period }}</view>
        <view class="big">{{ d.quota.left.toLocaleString() }}<text class="faint s"> / {{ d.quota.total.toLocaleString() }} 点</text></view>
        <view class="bar"><view class="bar-in" :class="{ low }" :style="{ width: `${pct}%` }"></view></view>
        <view v-if="d.explain?.length" class="hint">还能写 {{ d.explain.map((x) => `${x.n} ${x.what}`).join('，或 ') }}</view>
      </view>
      <view class="card">
        <view class="card-h"><text class="card-t">本月消耗</text></view>
        <view v-for="r in d.breakdown" :key="r.feature" class="u-row"><text class="grow">{{ r.feature }}</text><text class="faint">{{ r.calls }} 次</text><text class="u-cr">{{ r.credits.toLocaleString() }} 点</text></view>
        <view v-if="!d.breakdown.length" class="hint">这个月还没有消耗。</view>
        <view class="hint" style="margin-top: 12rpx">写稿很便宜，出图是大头。</view>
      </view>
      <view class="card">
        <view class="card-h"><text class="card-t">套餐</text></view>
        <view v-for="p in d.plans" :key="p.key" class="p-row" :class="{ on: p.key === d.quota.plan }">
          <view class="grow"><view class="p-n">{{ p.label }}<text v-if="p.key === d.quota.plan" class="chip">当前</text></view><view class="faint s">{{ p.credits.toLocaleString() }} 点/月 · {{ p.note }}</view></view>
          <text class="p-pr">{{ p.price ? `¥${p.price}` : '免费' }}</text>
        </view>
        <view class="hint" style="margin-top: 16rpx">升级套餐请在网页端「用量与套餐」里操作，手机上的额度会同步。</view>
      </view>
    </template>
  </view>
</template>

<script setup>
import { computed, ref } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import { api } from '../../lib/api.js';
import { toast } from '../../lib/ui.js';

const d = ref(null);
const pct = computed(() => (d.value?.quota?.total ? Math.max(0, Math.min(100, (d.value.quota.left / d.value.quota.total) * 100)) : 0));
const low = computed(() => pct.value < 15);

onShow(async () => {
  try { d.value = await api('/plan'); } catch (err) { toast(err.message); }
});
</script>

<style lang="scss" scoped>
.pl { padding-top: 20rpx; }
.s { font-size: 22rpx; }
.big { font-size: 64rpx; font-weight: 800; color: var(--accent-ink); margin: 8rpx 0; }
.bar { height: 12rpx; border-radius: 6rpx; background: var(--panel-2); overflow: hidden; margin-bottom: 12rpx; }
.bar-in { height: 100%; background: var(--accent); }
.bar-in.low { background: var(--danger); }
.u-row { display: flex; gap: 16rpx; padding: 16rpx 0; border-top: 2rpx solid var(--border); font-size: 26rpx; }
.u-cr { width: 140rpx; text-align: right; font-weight: 600; }
.p-row { display: flex; align-items: center; gap: 16rpx; padding: 20rpx; margin-top: 12rpx; border-radius: 16rpx; border: 2rpx solid var(--border); }
.p-row.on { border-color: var(--accent); background: #f7faff; }
.p-n { font-size: 30rpx; font-weight: 700; display: flex; align-items: center; gap: 10rpx; }
.p-pr { font-size: 32rpx; font-weight: 700; color: var(--accent-ink); }
</style>
