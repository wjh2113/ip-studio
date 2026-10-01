<template>
  <view class="login">
    <!-- 登录 / 注册 / 访问门禁。品牌是主视觉 -->
    <view class="hero">
      <image class="mark" src="/static/mark.png" mode="aspectFit" />
      <view class="brand">自媒体助手</view>
      <view class="sub">{{ gate ? '输入访问密码进入' : '给一个题材，先出三个方向，选中后生成完整成稿' }}</view>
    </view>
    <view class="panel">
      <view v-if="!gate" class="seg">
        <view class="seg-i" :class="{ on: mode === 'login' }" @tap="mode = 'login'">登录</view>
        <view v-if="canRegister" class="seg-i" :class="{ on: mode === 'register' }" @tap="mode = 'register'">注册</view>
      </view>
      <view v-if="!gate" class="field">
        <view class="label">用户名</view>
        <input class="input" v-model="username" maxlength="24" placeholder="2-24 位，支持中英文" placeholder-class="ph" />
      </view>
      <view class="field">
        <view class="label">{{ gate ? '访问密码' : '密码' }}</view>
        <input class="input" v-model="password" password maxlength="64" :placeholder="gate ? '访问密码' : '至少 6 位'" placeholder-class="ph" />
      </view>
      <view v-if="mode === 'register' && auth.invite" class="field">
        <view class="label">邀请码</view>
        <input class="input" v-model="invite" maxlength="40" placeholder="需要邀请码才能注册" placeholder-class="ph" />
      </view>
      <view v-if="error" class="err">{{ error }}</view>
      <button class="btn primary lg block" :loading="busy" :disabled="busy" @tap="submit">{{ gate ? '进入' : mode === 'login' ? '登录' : '注册并进入' }}</button>
      <view class="tip"><Ic name="info" :size="26" color="#98a2b3" /><text>{{ gate || !canRegister ? '不开放公开注册' : '每个账号的创作记录相互独立' }}</text></view>
    </view>
  </view>
</template>

<script setup>
import { computed, ref } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import Ic from '../../components/Ic.vue';
import { api } from '../../lib/api.js';
import { useSessionStore } from '../../stores/session.js';
import { useAccountStore } from '../../stores/account.js';
import { useJobsStore } from '../../stores/jobs.js';

const session = useSessionStore();
const mode = ref('login');
const username = ref('');
const password = ref('');
const invite = ref('');
const error = ref('');
const busy = ref(false);

const auth = computed(() => session.meta?.auth || {});
const gate = computed(() => Boolean(auth.value.gate));
const canRegister = computed(() => !gate.value && auth.value.register !== false);

onLoad(async () => {
  if (!session.meta) session.meta = await api('/meta').catch(() => null);
});

async function submit() {
  if (busy.value) return;
  error.value = '';
  busy.value = true;
  try {
    const m = gate.value ? 'login' : mode.value;
    await session.login(m, {
      username: gate.value ? '' : username.value.trim(),
      password: password.value,
      ...(m === 'register' ? { invite: invite.value } : {}),
    });
    const list = await useAccountStore().load().catch(() => []);
    useJobsStore().load();
    // 新注册、还没有账号：先去快速建号；老用户直接进今天
    if (!list.length) uni.reLaunch({ url: '/pages/account/quick?first=1' });
    else uni.switchTab({ url: '/pages/today/index' });
  } catch (err) {
    error.value = err.message;
  } finally {
    busy.value = false;
  }
}
</script>

<style lang="scss" scoped>
.login { min-height: 100vh; padding: calc(var(--status-bar-height) + 120rpx) 40rpx 60rpx; background: linear-gradient(180deg, #e9f0ff, var(--bg) 45%); }
.hero { text-align: center; margin-bottom: 60rpx; }
.mark { width: 140rpx; height: 140rpx; border-radius: 34rpx; box-shadow: 0 20rpx 40rpx -20rpx rgba(47, 107, 255, .6); }
.brand { font-size: 64rpx; font-weight: 800; letter-spacing: 4rpx; margin-top: 28rpx; }
.sub { font-size: 26rpx; color: var(--muted); margin-top: 12rpx; }
.panel { background: var(--panel); border-radius: 32rpx; padding: 36rpx 36rpx 28rpx; box-shadow: 0 20rpx 60rpx -30rpx rgba(16, 24, 40, .3); }
.panel .seg { margin-bottom: 36rpx; }
.err { color: var(--danger); font-size: 24rpx; margin: -8rpx 0 20rpx; }
.tip { display: flex; align-items: center; justify-content: center; gap: 8rpx; margin-top: 28rpx; font-size: 24rpx; color: var(--faint); }
</style>
