<template>
  <section class="card" data-sec="prompts">
    <div class="card-head">
      <h2>各功能的提示词</h2>
      <span class="counter" id="promptNote">{{ note }}</span>
    </div>
    <div class="prompts" id="prompts">
      <div v-if="error" class="ideas-state error">{{ error }}</div>
      <details v-for="p in list" :key="p.label" class="prompt-item">
        <summary><b>{{ p.label }}</b><span>{{ p.where }}</span></summary>
        <div class="prompt-body">
          <h4>system 提示词</h4>
          <pre>{{ p.system }}</pre>
          <template v-if="p.extra"><h4>逐个动作的指令</h4><pre>{{ JSON.stringify(p.extra, null, 2) }}</pre></template>
          <template v-if="p.schema"><h4>输出结构（JSON Schema）</h4><pre>{{ JSON.stringify(p.schema, null, 2) }}</pre></template>
        </div>
      </details>
    </div>
  </section>
</template>

<script setup>
/* 后台看「实际发给模型的」各功能提示词（只读；要改去 /prompts 说明书页） */
import { ref } from 'vue';
import { adminApi } from './store.js';

const list = ref([]);
const note = ref('');
const error = ref('');

adminApi('/admin/prompts')
  .then((d) => { list.value = d.prompts; note.value = d.note; })
  .catch((err) => { error.value = err.message; });
</script>
