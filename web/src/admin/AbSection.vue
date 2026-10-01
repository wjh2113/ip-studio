<template>
  <section class="card" data-sec="ab">
    <!-- A/B 的意义全在「记下每次用了哪个变体」上：同一个功能挂多份 system，按权重分流 -->
    <h2>提示词 A/B<span class="sub">同一个功能挂多份 system，按权重分流；每次调用都记下用的哪一份</span></h2>
    <div class="ab-bar">
      <select id="abFeature" v-model="feature" @change="load">
        <option v-for="f in features" :key="f.key" :value="f.key">{{ f.label }}</option>
      </select>
      <button class="btn ghost small" id="abNewBtn" @click="open(null)">＋ 新变体</button>
      <span class="grow"></span>
      <span class="hint" id="abHint">{{ hint }}</span>
    </div>
    <div id="abList">
      <div class="ab-row"><b>内置</b><span class="note">代码里的那份，{{ builtin.length }} 字</span><span class="w">权重 1</span></div>
      <div v-for="v in variants" :key="v.id" class="ab-row" :class="{ on: v.active && v.weight > 0 }">
        <b>{{ v.name }}</b>
        <span class="note">{{ v.note || `${v.system.length} 字` }}</span>
        <span class="w">权重 {{ v.weight }}{{ v.active ? '' : ' · 停用' }}</span>
        <button class="mini" :data-abedit="v.id" @click="open(v)">改</button>
        <button class="mini" :data-abdel="v.id" @click="remove(v)">删</button>
      </div>
    </div>

    <div v-if="ed.open" class="ab-edit" id="abEdit">
      <div class="grid">
        <label>变体名<input id="abName" v-model="ed.name" maxlength="40" placeholder="例：更狠的差异要求"></label>
        <label>权重<input id="abWeight" v-model.number="ed.weight" type="number" min="0" max="20"></label>
        <label class="chk"><input type="checkbox" id="abActive" v-model="ed.active"> 生效（参与线上分流）</label>
      </div>
      <label class="full">备注<input id="abNote" v-model="ed.note" maxlength="300" placeholder="改了什么、想验证什么"></label>
      <label class="full">system 提示词<textarea id="abSystem" v-model="ed.system" rows="12" spellcheck="false"></textarea></label>
      <div class="ab-edit-foot">
        <button class="btn ghost small" id="abFromBuiltin" @click="ed.system = builtin">从内置那份复制</button>
        <span class="grow"></span>
        <button class="btn ghost small" id="abCancel" @click="ed.open = false">取消</button>
        <BusyBtn class="btn primary small" id="abSave" :busy="saving" @click="save">保存</BusyBtn>
      </div>
      <p class="form-error" id="abError">{{ ed.error }}</p>
    </div>
  </section>
</template>

<script setup>
import { computed, reactive, ref, watch } from 'vue';
import BusyBtn from '../components/common/BusyBtn.vue';
import { ask, toast } from '../lib/feedback.js';
import { adminApi, useAdminStore } from './store.js';
import { useAdminFeatures } from './features.js';

const { features, feature } = useAdminFeatures();
const variants = ref([]);
const hintError = ref('');
const saving = ref(false);
const ed = reactive({ open: false, id: null, name: '', weight: 1, active: false, note: '', system: '', error: '' });

const builtin = computed(() => features.value.find((f) => f.key === feature.value)?.builtin || '');
const hint = computed(() => {
  if (hintError.value) return hintError.value;
  const live = variants.value.filter((v) => v.active && v.weight > 0);
  // 内置也参与分流，否则一开 A/B 就是全量换成新提示词
  return live.length ? `线上分流中：内置 + ${live.length} 个变体（内置也参与，否则一开 A/B 就是全量换新提示词）` : '当前只有内置那份在跑';
});

async function load() {
  try {
    const d = await adminApi(`/admin/variants${feature.value ? `?feature=${feature.value}` : ''}`);
    features.value = d.features;
    if (!feature.value && d.features.length) { feature.value = d.features[0].key; await load(); return; }
    variants.value = d.variants;
    hintError.value = '';
  } catch (err) { hintError.value = err.message; }
}

function open(v) {
  Object.assign(ed, {
    open: true, id: v?.id ?? null, name: v?.name || '', weight: v?.weight ?? 1, active: Boolean(v?.active),
    note: v?.note || '', system: v?.system || '', error: '',
  });
}

async function save() {
  saving.value = true;
  try {
    const body = { feature: feature.value, name: ed.name.trim(), system: ed.system, weight: Number(ed.weight), active: ed.active, note: ed.note.trim() };
    await adminApi(ed.id ? `/admin/variants/${ed.id}` : '/admin/variants', { method: ed.id ? 'PUT' : 'POST', body });
    ed.open = false;
    await load();
    toast('已保存');
  } catch (err) { ed.error = err.message; } finally { saving.value = false; }
}

async function remove(v) {
  if (!await ask.confirm({ title: '删掉这个变体？', body: '已经跑过的 eval 结果不受影响。', ok: '删除', danger: true })) return;
  try { await adminApi(`/admin/variants/${v.id}`, { method: 'DELETE' }); await load(); } catch (err) { toast(err.message); }
}

load();

// 顶栏「刷新」/换天数时跟着重拉（第一次 load 由上面自己触发，这里只管之后的）
watch(() => useAdminStore().tick, () => load());
</script>
