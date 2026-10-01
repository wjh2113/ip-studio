<template>
  <div class="toast" id="toast" :class="{ hidden: !t.show }" role="status" aria-live="polite">{{ t.text }}</div>
</template>

<script setup>
import { toastState as t } from '../../lib/feedback.js';
</script>
