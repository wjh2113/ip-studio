<template>
  <view v-if="modelValue" class="sheet-mask" @tap="close"></view>
  <view v-if="modelValue" class="sheet" :class="{ tall }">
    <!-- 底部弹层：标题行 + 内容。半屏为主，tall 时撑到 85% 高 -->
    <view class="sheet-grip"></view>
    <view v-if="title" class="sheet-h">
      <text class="sheet-t">{{ title }}</text>
      <text v-if="sub" class="sheet-sub">{{ sub }}</text>
      <view class="grow"></view>
      <view class="sheet-x" @tap="close"><Ic name="x" :size="32" color="#667085" /></view>
    </view>
    <scroll-view scroll-y class="sheet-body"><slot /></scroll-view>
    <view v-if="$slots.foot" class="sheet-foot"><slot name="foot" /></view>
  </view>
</template>

<script setup>
import Ic from './Ic.vue';

defineProps({
  modelValue: Boolean,
  title: { type: String, default: '' },
  sub: { type: String, default: '' },
  tall: Boolean,
});
const emit = defineEmits(['update:modelValue']);
const close = () => emit('update:modelValue', false);
</script>

<style lang="scss" scoped>
.sheet-mask { position: fixed; inset: 0; z-index: 90; background: rgba(17, 24, 39, .4); }
.sheet {
  position: fixed; left: 0; right: 0; bottom: 0; z-index: 91;
  max-height: 70vh; display: flex; flex-direction: column;
  background: var(--panel); border-radius: 32rpx 32rpx 0 0;
  padding-bottom: env(safe-area-inset-bottom);
}
.sheet.tall { max-height: 88vh; }
.sheet-grip { width: 72rpx; height: 8rpx; border-radius: 4rpx; background: var(--line-strong); margin: 16rpx auto 4rpx; }
.sheet-h { display: flex; align-items: baseline; gap: 12rpx; padding: 16rpx 32rpx 20rpx; }
.sheet-t { font-size: 34rpx; font-weight: 700; }
.sheet-sub { font-size: 24rpx; color: var(--muted); }
.sheet-x { padding: 8rpx; }
.sheet-body { flex: 1; min-height: 0; padding: 0 32rpx 24rpx; }
.sheet-foot { padding: 16rpx 32rpx 24rpx; border-top: 2rpx solid var(--border); }
</style>
