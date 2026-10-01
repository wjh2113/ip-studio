<template>
  <button :type="type" :disabled="busy || disabled">
    <template v-if="busy"><span class="spinner"></span> {{ busyText }}</template>
    <slot v-else />
  </button>
</template>

<script setup>
/* 提交中显示转圈并禁用的按钮。class、id、@click 等照常写在外面，会落到 button 上 */
defineProps({
  busy: { type: Boolean, default: false },
  disabled: { type: Boolean, default: false },
  type: { type: String, default: 'button' },
  busyText: { type: String, default: '处理中' },
});
</script>
