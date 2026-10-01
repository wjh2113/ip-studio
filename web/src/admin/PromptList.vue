<template>
  <section class="card" data-sec="prompts">
    <div class="card-head">
      <h2>各功能的提示词</h2>
      <span class="counter" id="promptNote">{{ note }}</span>
      <button type="button" class="btn ghost small" id="promptReload" :disabled="loading" @click="load">刷新</button>
      <a class="btn ghost small" href="/prompts" id="promptEditLink">说明书页</a>
    </div>
    <p class="hint" style="margin:0 0 12px">在这里直接改、保存为新版本、切回旧版。改了会影响全站所有用户的生成。</p>
    <div class="prompts" id="prompts">
      <div v-if="error" class="ideas-state error">{{ error }}</div>
      <p v-else-if="loading && !list.length" class="hint">加载中…</p>
      <details v-for="p in list" :key="p.key" class="prompt-item" :open="openKey === p.key" @toggle="onToggle(p, $event)">
        <summary>
          <b>{{ p.name }}</b>
          <span>{{ p.where }}</span>
          <span v-if="p.customized" class="fw-tag">已手改</span>
        </summary>
        <div class="prompt-body">
          <h4>system 提示词（{{ (drafts[p.key] ?? p.system).length }} 字）</h4>
          <textarea class="prompt-edit" :data-prompt="p.key" rows="14" spellcheck="false"
            :value="drafts[p.key] ?? p.system" @input="drafts[p.key] = $event.target.value"></textarea>
          <div class="prompt-acts">
            <BusyBtn class="btn primary small" :data-save-prompt="p.key" :busy="saving === p.key" @click="save(p)">保存为新版本</BusyBtn>
            <span class="hint">{{ msgs[p.key] || '保存后之后的生成用这一版；旧版留在下面。' }}</span>
          </div>
          <div v-if="p.history?.length" class="prompt-hist">
            <div v-for="h in p.history" :key="h.id" class="hist-row" :class="{ on: h.active }">
              <span>{{ h.active ? '当前 · ' : '' }}{{ h.source === 'edit' ? '手改' : '代码' }} · {{ stamp(h.created_at) }} · {{ h.chars }} 字</span>
              <button type="button" @click="drafts[p.key] = h.system">查看</button>
              <button v-if="!h.active" type="button" @click="activate(p, h)">用这一版</button>
            </div>
          </div>
          <template v-if="p.schema">
            <h4>输出结构（JSON Schema）</h4>
            <pre>{{ JSON.stringify(p.schema, null, 2) }}</pre>
          </template>
        </div>
      </details>
    </div>
  </section>
</template>

<script setup>
/* 管理后台直接改提示词（管理员已登录）；与 /prompts 说明书共用同一套接口与版本表。 */
import { reactive, ref, watch } from 'vue';
import BusyBtn from '../components/common/BusyBtn.vue';
import { ask, toast } from '../lib/feedback.js';
import { adminApi, useAdminStore } from './store.js';

defineProps({ hidden: Boolean });

const a = useAdminStore();
const list = ref([]);
const note = ref('登录管理员后即可改并保存版本');
const error = ref('');
const loading = ref(false);
const drafts = reactive({});
const msgs = reactive({});
const saving = ref('');
const openKey = ref('');

function stamp(iso) {
  return String(iso || '').replace('T', ' ').slice(0, 16);
}

async function load() {
  loading.value = true;
  error.value = '';
  try {
    const d = await adminApi('/prompt-docs');
    if (!d.canEdit) {
      error.value = '当前没有管理员会话，请重新登录管理后台';
      list.value = [];
      return;
    }
    list.value = d.prompts || [];
    note.value = `共 ${list.value.length} 条 · 已登录管理员，可直接改`;
    for (const k of Object.keys(drafts)) delete drafts[k];
  } catch (err) {
    error.value = err.message;
    list.value = [];
  } finally {
    loading.value = false;
  }
}

function onToggle(p, ev) {
  if (ev.target.open) openKey.value = p.key;
}

async function save(p) {
  saving.value = p.key;
  try {
    const system = drafts[p.key] ?? p.system;
    const body = await adminApi(`/prompt-docs/${p.key}`, { method: 'PUT', body: { system } });
    msgs[p.key] = '';
    toast('已保存为新版本');
    const row = list.value.find((x) => x.key === p.key);
    if (row) {
      row.system = body.system;
      row.history = body.history;
      row.customized = true;
    }
    drafts[p.key] = body.system;
  } catch (err) {
    msgs[p.key] = err.message;
    toast(err.message);
  } finally {
    saving.value = '';
  }
}

async function activate(p, h) {
  if (!await ask.confirm({ title: '之后的生成改用这一版？', body: '当前正在用的那一版会留在历史里，可以再切回去。', ok: '使用' })) return;
  try {
    const body = await adminApi(`/prompt-docs/${p.key}/revisions/${h.id}/activate`, { method: 'POST', body: {} });
    toast('已切换版本');
    const row = list.value.find((x) => x.key === p.key);
    if (row) {
      row.system = body.system;
      row.history = body.history;
      row.customized = body.history?.some((x) => x.active && x.source === 'edit');
    }
    drafts[p.key] = body.system;
  } catch (err) { toast(err.message); }
}

watch(() => a.section, (sec) => { if (sec === 'prompts') load(); }, { immediate: true });
watch(() => a.tick, () => { if (a.section === 'prompts') load(); });
</script>
