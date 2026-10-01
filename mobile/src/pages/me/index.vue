<template>
  <view class="page me">
    <view class="me-top" :style="{ paddingTop: `${statusH + 16}px` }">
      <view class="tb-title">我的</view>
    </view>
    <!-- 我的：账号、用量、各个入口、本机设置。管理后台不进手机 -->
    <view class="card acc-card" @tap="switchAcc">
      <view class="avatar" :data-tone="tone">{{ acc.current?.name?.[0] || '全' }}</view>
      <view class="grow">
        <view class="acc-n">{{ acc.current?.name || '全部账号' }}</view>
        <view class="faint s ellipsis">{{ acc.current ? `${session.platformLabel(acc.current.platform)} · ${acc.current.content_focus || '还没写定位'}` : `${acc.list.length} 个账号` }}</view>
      </view>
      <view class="sw"><Ic name="swap" :size="28" color="#1f56e0" />切换</view>
    </view>

    <view class="card plan" @tap="go('me/plan')">
      <view class="grow">
        <view class="faint s">{{ quota?.label || '套餐' }} · 剩余点数</view>
        <view class="pl-n">{{ quota ? quota.left.toLocaleString() : '—' }}<text class="faint s"> / {{ quota?.total?.toLocaleString() || '—' }}</text></view>
      </view>
      <text class="more">用量与套餐<Ic name="chev-right" :size="24" color="#667085" /></text>
    </view>

    <view class="card list">
      <view v-for="x in LINKS" :key="x.label" class="li" @tap="x.go()">
        <view class="li-ic" :style="{ background: x.bg }"><Ic :name="x.icon" :size="32" :color="x.color" /></view>
        <text class="grow">{{ x.label }}</text>
        <Ic name="chev-right" :size="26" color="#98a2b3" />
      </view>
    </view>

    <view class="card">
      <view class="card-h"><text class="card-t">设置</text></view>
      <view class="li set">
        <text class="grow">提词器默认场景</text>
        <view class="seg mini"><view v-for="(p, k) in PRESETS" :key="k" class="seg-i" :class="{ on: prefs.preset === k }" @tap="prefs.preset = k">{{ p.label }}</view></view>
      </view>
      <view class="li set"><text class="grow">录口播时防息屏</text><switch :checked="prefs.keepAwake" color="#2f6bff" @change="(e) => (prefs.keepAwake = e.detail.value)" /></view>
      <view class="li set"><text class="grow">提词器默认镜像</text><switch :checked="prefs.mirror" color="#2f6bff" @change="(e) => (prefs.mirror = e.detail.value)" /></view>
      <view class="sub-h">提醒（推送接入后生效）</view>
      <view v-for="n in NOTIFY" :key="n.key" class="li set"><text class="grow">{{ n.label }}</text><switch :checked="prefs.notify[n.key]" color="#2f6bff" @change="(e) => (prefs.notify[n.key] = e.detail.value)" /></view>
    </view>

    <view class="card list">
      <view class="li" @tap="openDocs"><view class="li-ic" style="background: #f2f4f7"><Ic name="book" :size="32" color="#667085" /></view><text class="grow">说明书 / 帮助</text><Ic name="chev-right" :size="26" color="#98a2b3" /></view>
      <view class="li" @tap="logout"><view class="li-ic" style="background: #fdeeee"><Ic name="logout" :size="32" color="#e5484d" /></view><text class="grow danger">退出登录</text></view>
    </view>
    <view class="ver faint">自媒体助手 · {{ session.user?.username }}</view>
  </view>
</template>

<script setup>
import { computed, ref } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import Ic from '../../components/Ic.vue';
import { api, url } from '../../lib/api.js';
import { confirm, go, sheet } from '../../lib/ui.js';
import { useSessionStore } from '../../stores/session.js';
import { useAccountStore } from '../../stores/account.js';
import { PRESETS, usePrefs } from '../../stores/prefs.js';

const LINKS = [
  { label: '内容日历', icon: 'calendar', color: '#2f6bff', bg: '#eef3ff', go: () => go('calendar/index') },
  { label: '对标速存', icon: 'link', color: '#7c5cff', bg: '#f1edff', go: () => go('inspire/benchmark') },
  { label: '喂给语气样本', icon: 'mic', color: '#12b886', bg: '#e6f8f1', go: () => go('account/feed') },
  { label: '快速建号', icon: 'user', color: '#f59e0b', bg: '#fff5e5', go: () => go('account/quick') },
  { label: '复盘', icon: 'chart', color: '#2f6bff', bg: '#eef3ff', go: () => go('metrics/insights') },
  { label: '任务', icon: 'clipboard', color: '#667085', bg: '#f2f4f7', go: () => go('jobs/index') },
];
const NOTIFY = [
  { key: 'metrics', label: '发布后第 1、7 天回填' },
  { key: 'morning', label: '早上：今天有没有可发的' },
  { key: 'speak', label: '口播未练' },
  { key: 'jobs', label: '任务完成 / 失败' },
  { key: 'quota', label: '额度将用尽' },
];

const session = useSessionStore();
const acc = useAccountStore();
const prefs = usePrefs();
const quota = ref(null);
const statusH = uni.getSystemInfoSync().statusBarHeight || 20;
const tone = computed(() => [...(acc.current?.name || '')].reduce((n, ch) => n + ch.charCodeAt(0), 0) % 5);

onShow(async () => {
  try { quota.value = (await api('/plan')).quota; } catch { /* 拿不到就显示横杠 */ }
});

async function switchAcc() {
  const names = [...acc.list.map((p) => p.name), '全部账号'];
  const i = await sheet(names);
  if (i < 0) return;
  acc.select(i < acc.list.length ? acc.list[i].id : null);
}

function openDocs() {
  // #ifdef H5
  window.open(url('/prompts'), '_blank');
  // #endif
  // #ifdef APP-PLUS
  plus.runtime.openURL(url('/prompts'));
  // #endif
}

async function logout() {
  if (!(await confirm({ title: '退出登录？', ok: '退出', danger: true }))) return;
  await session.logout();
  uni.reLaunch({ url: '/pages/login/index' });
}
</script>

<style lang="scss" scoped>
.me-top { padding-left: 28rpx; padding-right: 28rpx; }
.tb-title { font-size: 44rpx; font-weight: 700; padding: 4rpx 0 16rpx; }
.acc-card { display: flex; align-items: center; gap: 20rpx; }
.acc-n { font-size: 32rpx; font-weight: 700; }
.s { font-size: 22rpx; }
.sw { display: flex; align-items: center; gap: 6rpx; font-size: 24rpx; color: var(--accent-ink); padding: 10rpx 18rpx; border-radius: 24rpx; background: var(--accent-soft); }
.plan { display: flex; align-items: center; background: linear-gradient(135deg, #eef3ff, #fff); }
.pl-n { font-size: 48rpx; font-weight: 800; color: var(--accent-ink); }
.list { padding-top: 8rpx; padding-bottom: 8rpx; }
.li { display: flex; align-items: center; gap: 20rpx; padding: 20rpx 0; font-size: 28rpx; border-bottom: 2rpx solid var(--border); }
.li:last-child { border-bottom: 0; }
.li-ic { width: 64rpx; height: 64rpx; border-radius: 18rpx; display: flex; align-items: center; justify-content: center; }
.li.set { padding: 18rpx 0; }
.seg.mini { width: 300rpx; padding: 4rpx; }
.seg.mini .seg-i { padding: 8rpx 0; font-size: 24rpx; }
.sub-h { font-size: 24rpx; color: var(--muted); margin-top: 20rpx; }
.danger { color: var(--danger); }
.ver { text-align: center; font-size: 22rpx; padding: 20rpx 0 40rpx; }
</style>
