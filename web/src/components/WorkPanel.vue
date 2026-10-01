<template>
  <section class="wpanel" :class="{ closed: !open }">
    <!-- 成稿右栏的一块：标题行可点开收起，标题旁一句小结（几条建议、出了几张图） -->
    <button type="button" class="wp-head" :aria-expanded="String(open)" @click="open = !open">
      <Icon :name="icon" :size="15" />
      <span class="wp-title">{{ title }}</span>
      <span v-if="badge" class="wp-badge">{{ badge }}</span>
      <span class="grow"></span>
      <Icon class="wp-caret" name="chev-up" :size="14" />
    </button>
    <div v-show="open" class="wp-body"><slot /></div>
  </section>
</template>

<script setup>
import { ref, watch } from 'vue';
import Icon from './common/Icon.vue';

const p = defineProps({
  title: { type: String, required: true },
  icon: { type: String, default: 'list' },
  badge: { type: String, default: '' },
  active: { type: Boolean, default: false },   // 这块有东西要看了（从菜单打开配图、检查回来了）：收起着就自动展开
});
const open = ref(true);
watch(() => p.active, (on) => { if (on) open.value = true; });
</script>
