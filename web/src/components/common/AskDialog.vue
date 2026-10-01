<template>
  <div v-if="d" class="ask-mask" @mousedown.self="no">
    <div class="ask" role="dialog" aria-modal="true" ref="box">
      <h3 v-if="d.title">{{ d.title }}</h3>
      <p v-if="d.body" class="ask-body">{{ d.body }}</p>
      <label v-for="f in d.fields || []" :key="f.key" class="ask-field">{{ f.label || '' }}
        <textarea v-if="f.multiline" v-model="values[f.key]" :data-k="f.key" :rows="f.rows || 3"
          :placeholder="f.placeholder || ''" :class="{ bad: bad === f.key }"></textarea>
        <input v-else v-model="values[f.key]" :data-k="f.key" :type="f.type || 'text'"
          :placeholder="f.placeholder || ''" :class="{ bad: bad === f.key }" />
      </label>
      <div class="ask-foot">
        <button type="button" class="btn ghost small" data-no @click="no">{{ d.cancel }}</button>
        <button type="button" class="btn small" :class="d.danger ? 'danger' : 'primary'" data-yes @click="yes">{{ d.ok }}</button>
      </div>
    </div>
  </div>
</template>

<script setup>
/* 应用内对话框的界面。调用入口在 lib/feedback.js 的 ask */
import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from 'vue';
import { askState } from '../../lib/feedback.js';

const d = computed(() => askState.open);
const values = reactive({});
const bad = ref('');
const box = ref(null);

function yes() {
  const cur = d.value;
  if (!cur) return;
  if (!cur.fields) { cur.resolve(true); return; }
  const v = Object.fromEntries(cur.fields.map((f) => [f.key, String(values[f.key] ?? '').trim()]));
  // 必填项空着就别让人以为提交成功了——标红，不关窗
  const miss = cur.fields.find((f) => f.required && !v[f.key]);
  if (miss) {
    bad.value = miss.key;
    box.value?.querySelector(`[data-k="${miss.key}"]`)?.focus();
    return;
  }
  cur.resolve(v);
}

function no() {
  const cur = d.value;
  if (cur) cur.resolve(cur.fields ? null : false);
}

function onKey(e) {
  if (!d.value) return;
  if (e.key === 'Escape') { e.stopPropagation(); no(); return; }
  // 多行输入里回车是换行，不该提交
  if (e.key === 'Enter' && !e.shiftKey && e.target.tagName !== 'TEXTAREA') { e.preventDefault(); yes(); }
}

watch(d, async (cur) => {
  document.removeEventListener('keydown', onKey, true);
  if (!cur) return;
  for (const k of Object.keys(values)) delete values[k];
  for (const f of cur.fields || []) values[f.key] = f.value ?? '';
  bad.value = '';
  // 捕获阶段监听：Esc 只关对话框，不要顺带关掉下面的浮层
  document.addEventListener('keydown', onKey, true);
  await nextTick();
  // 有输入框就聚焦第一个，否则聚焦主按钮——纯确认时回车能直接过
  const first = box.value?.querySelector('[data-k]');
  (first || box.value?.querySelector('[data-yes]'))?.focus();
  first?.select?.();
});

onBeforeUnmount(() => document.removeEventListener('keydown', onKey, true));
</script>
