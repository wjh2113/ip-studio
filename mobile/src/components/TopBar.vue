<template>
  <view class="topbar" :style="{ paddingTop: `${statusH}px` }">
    <!-- Tab 页顶栏：左边当前账号（点开切换），右边任务入口。切换后今天、口播、回填都跟这个号走 -->
    <view class="tb-row">
      <view class="acc" @tap="open = !open">
        <view class="avatar" :data-tone="tone">{{ current?.name?.[0] || '全' }}</view>
        <view class="acc-txt">
          <view class="acc-name ellipsis">{{ current?.name || '全部账号' }}<Ic name="chev-down" :size="28" color="#667085" /></view>
          <view v-if="current" class="chip">{{ platform }}</view>
        </view>
      </view>
      <view class="grow"></view>
      <slot name="right">
        <view class="tasks" @tap="go('jobs/index')">
          <Ic name="clipboard" :size="34" />
          <text>任务</text>
          <view v-if="jobs.active.length" class="badge">{{ jobs.active.length }}</view>
        </view>
      </slot>
    </view>
    <view v-if="title" class="tb-title">{{ title }}</view>

    <!-- 账号切换器 -->
    <view v-if="open" class="mask" @tap="open = false"></view>
    <view v-if="open" class="switcher" :style="{ top: `${statusH + 56}px` }">
      <view class="sw-h"><text>账号切换</text><view class="grow"></view><text class="sw-link" @tap="addAccount">添加账号</text></view>
      <view v-for="p in acc.list" :key="p.id" class="sw-i" :class="{ on: p.id === acc.currentId }" @tap="pick(p.id)">
        <view class="avatar sm" :data-tone="toneOf(p.name)">{{ p.name?.[0] }}</view>
        <view class="grow">
          <view class="sw-name">{{ p.name }}</view>
          <view class="sw-sub ellipsis">{{ session.platformLabel(p.platform) }}{{ p.content_focus ? ` · ${p.content_focus}` : '' }}</view>
        </view>
        <Ic v-if="p.id === acc.currentId" name="check" color="#2f6bff" :size="32" />
      </view>
      <view class="sw-i" :class="{ on: !acc.currentId }" @tap="pick(null)">
        <view class="avatar sm all"><Ic name="layers" :size="28" color="#667085" /></view>
        <view class="grow"><view class="sw-name">全部账号</view><view class="sw-sub">不限账号，看全部稿子</view></view>
      </view>
      <view class="sw-add" @tap="addAccount"><Ic name="plus" color="#2f6bff" :size="30" /><text>快速建号</text></view>
    </view>
  </view>
</template>

<script setup>
import { computed, ref } from 'vue';
import Ic from './Ic.vue';
import { useAccountStore } from '../stores/account.js';
import { useSessionStore } from '../stores/session.js';
import { useJobsStore } from '../stores/jobs.js';
import { go } from '../lib/ui.js';

defineProps({ title: { type: String, default: '' } });

const acc = useAccountStore();
const session = useSessionStore();
const jobs = useJobsStore();
const open = ref(false);
const statusH = uni.getSystemInfoSync().statusBarHeight || 20;

const current = computed(() => acc.current);
const platform = computed(() => session.platformLabel(current.value?.platform));
const toneOf = (name = '') => [...name].reduce((n, ch) => n + ch.charCodeAt(0), 0) % 5;
const tone = computed(() => toneOf(current.value?.name || ''));

function pick(id) {
  acc.select(id);
  open.value = false;
}
function addAccount() {
  open.value = false;
  go('account/quick');
}
</script>

<style lang="scss" scoped>
.topbar { position: sticky; top: 0; z-index: 50; background: var(--bg); padding-left: 28rpx; padding-right: 28rpx; }
.tb-row { display: flex; align-items: center; height: 56px; }
.tb-title { font-size: 44rpx; font-weight: 700; padding: 4rpx 0 16rpx; }
.acc { display: flex; align-items: center; gap: 16rpx; min-width: 0; }
.acc-txt { min-width: 0; }
.acc-name { display: flex; align-items: center; gap: 6rpx; font-size: 32rpx; font-weight: 700; max-width: 420rpx; }
.mask { position: fixed; inset: 0; z-index: 60; background: rgba(17, 24, 39, .25); }
.switcher {
  position: fixed; left: 24rpx; z-index: 61; width: 560rpx; padding: 16rpx;
  background: var(--panel); border-radius: 24rpx; box-shadow: 0 16rpx 48rpx rgba(16, 24, 40, .2);
}
.sw-h { display: flex; align-items: center; padding: 12rpx 16rpx 16rpx; font-size: 24rpx; color: var(--muted); }
.sw-link { color: var(--accent-ink); }
.sw-i { display: flex; align-items: center; gap: 20rpx; padding: 18rpx 16rpx; border-radius: 16rpx; }
.sw-i.on { background: var(--accent-soft); }
.sw-name { font-size: 28rpx; font-weight: 600; }
.sw-sub { font-size: 22rpx; color: var(--muted); max-width: 360rpx; }
.sw-add { display: flex; align-items: center; gap: 12rpx; padding: 22rpx 16rpx 10rpx; color: var(--accent-ink); font-size: 28rpx; border-top: 2rpx solid var(--border); margin-top: 8rpx; }
</style>
