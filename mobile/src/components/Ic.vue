<template>
  <image class="ic" :src="src" :style="{ width: px, height: px }" mode="aspectFit" />
</template>

<script setup>
/* 图标：<Ic name="plus" color="#2f6bff" :size="36" />，size 是 rpx */
import { computed } from 'vue';
import { iconSrc } from '../lib/icons.js';

const props = defineProps({
  name: { type: String, required: true },
  color: { type: String, default: '#1b2232' },
  size: { type: [Number, String], default: 36 },
  stroke: { type: Number, default: 1.8 },
});
const src = computed(() => iconSrc(props.name, props.color, props.stroke));
const px = computed(() => `${props.size}rpx`);
</script>

<style scoped>
.ic { flex: none; display: inline-block; vertical-align: middle; }
</style>
