<template>
  <view class="steps">
    <!-- 创作三步：选题 → 方向 → 成稿 -->
    <template v-for="(s, i) in STEPS" :key="s">
      <view v-if="i" class="st-line" :class="{ on: i < step }"></view>
      <view class="st" :class="{ on: i + 1 === step, done: i + 1 < step }">
        <view class="st-n"><Ic v-if="i + 1 < step" name="check" color="#2f6bff" :size="22" :stroke="3" /><text v-else>{{ i + 1 }}</text></view>
        <text>{{ s }}</text>
      </view>
    </template>
  </view>
</template>

<script setup>
import Ic from './Ic.vue';

defineProps({ step: { type: Number, default: 1 } });
const STEPS = ['选题', '方向', '成稿'];
</script>

<style lang="scss" scoped>
.steps { display: flex; align-items: center; padding: 16rpx 40rpx 24rpx; }
.st { display: flex; align-items: center; gap: 10rpx; font-size: 26rpx; color: var(--faint); }
.st-n { width: 40rpx; height: 40rpx; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 22rpx; background: var(--panel-2); border: 2rpx solid var(--border); }
.st.on { color: var(--accent-ink); font-weight: 600; }
.st.on .st-n { background: var(--accent); border-color: var(--accent); color: #fff; }
.st.done { color: var(--accent-ink); }
.st.done .st-n { background: var(--accent-soft); border-color: transparent; }
.st-line { flex: 1; height: 4rpx; margin: 0 16rpx; background: var(--border); border-radius: 2rpx; }
.st-line.on { background: var(--accent); }
</style>
