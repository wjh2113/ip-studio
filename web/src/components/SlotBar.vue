<template>
  <!-- 一条横向色条，宽度按篇幅占比，一眼看出结构 -->
  <div class="fw-bar-slots">
    <span v-for="(x, i) in slots" :key="i" class="fw-seg" :class="`s${i % 6}`" :style="{ flex: Math.max(x.ratio, 0.02) }"
      :title="`${x.role} ${Math.round(x.ratio * 100)}%`">{{ x.role }}</span>
  </div>
</template>

<script setup>
defineProps({ slots: { type: Array, default: () => [] } });
</script>
