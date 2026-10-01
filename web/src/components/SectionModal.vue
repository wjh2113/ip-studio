<template>
  <Modal id="sectionModal" v-model:open="open" title="内容栏目" :sub="persona ? `账号「${persona.name}」` : ''"
    close-id="sectionModalClose" sub-id="sectionModalSub" @close="closed">
    <p class="hint">给这个号分几条内容线，创作时可以指定本篇属于哪条。不选就是常规创作。</p>

    <div class="section-list" id="sectionList">
      <div v-for="x in s.sections" :key="x.id" class="section-row" :data-row="x.id">
        <div class="info">
          <span class="nm">{{ x.name }}</span>
          <span v-if="x.purpose" class="ps">{{ x.purpose }}</span>
        </div>
        <span v-if="x.draft_count" class="cnt">{{ x.draft_count }} 篇</span>
        <button type="button" :data-edit="x.id" @click="openForm(x, x.id)">编辑</button>
        <button type="button" class="del" :data-delsec="x.id" title="删除" @click="del(x)">×</button>
      </div>
    </div>

    <div class="section-add">
      <select id="sectionPreset" v-model="preset">
        <option value="">自定义栏目…</option>
        <option v-for="p in presets" :key="p.name" :value="p.name">{{ p.name }}</option>
      </select>
      <button class="btn ghost small" type="button" id="sectionAddBtn" @click="add">添加</button>
    </div>

    <!-- 用 hidden 类开关（浏览器测试按 .hidden 判断表单收没收起） -->
    <div class="section-form" id="sectionForm" :class="{ hidden: !form.open }">
      <label class="full">栏目名 <span class="req">*</span>
        <input id="sectionName" maxlength="20" v-model="form.name" placeholder="例：来时路" ref="nameBox" />
      </label>
      <label class="full">这个栏目讲什么
        <textarea id="sectionPurpose" rows="2" maxlength="300" v-model="form.purpose"
          placeholder="例：讲清楚这个号是怎么来的、为什么是我在做、和别人的不一样在哪"></textarea>
      </label>
      <label class="full">写作要点
        <textarea id="sectionGuide" rows="3" maxlength="600" v-model="form.guide" placeholder="这个栏目该怎么写、不该怎么写"></textarea>
      </label>
      <label class="full">默认写法框架
        <!-- 内置 + 我的。每次打开表单都拉一次，框架库里刚加的也能选 -->
        <select id="sectionFramework" v-model="form.framework">
          <option value="">不指定</option>
          <optgroup v-if="fwMine.length" label="我的"><option v-for="f in fwMine" :key="f.key" :value="f.key">{{ f.name }}</option></optgroup>
          <optgroup v-if="fwBuiltin.length" label="内置"><option v-for="f in fwBuiltin" :key="f.key" :value="f.key">{{ f.name }}</option></optgroup>
        </select>
        <span class="hint">选这个栏目创作时自动带上，简报里还能换</span>
      </label>

      <div class="field-editor">
        <div class="field-editor-head">
          <span>写这个栏目时需要你提供的素材</span>
          <button type="button" class="btn ghost small" id="fieldAddBtn" @click="addField">＋ 加一项</button>
        </div>
        <p class="hint">比如「来时路」需要你的背景经历。创作时选中这个栏目就会问你要，模型只能用你填的，不会自己编。</p>
        <div class="field-rows" id="fieldRows" ref="rowsBox">
          <div v-for="(f, i) in form.fields" :key="f.uid" class="field-row">
            <input type="text" class="lbl" v-model="f.label" maxlength="30" placeholder="要什么，如：你的背景经历" />
            <input type="text" class="hnt" v-model="f.hint" maxlength="80" placeholder="给自己的提示（选填）" />
            <label class="req-box"><input type="checkbox" v-model="f.required" />必填</label>
            <button type="button" class="del" title="删掉这项" @click="removeField(i)">×</button>
          </div>
        </div>
      </div>

      <p class="form-error" id="sectionError">{{ form.error }}</p>
      <div class="section-form-foot">
        <button class="btn ghost small" type="button" id="sectionCancelBtn" @click="form.open = false">取消</button>
        <BusyBtn class="btn primary small" id="sectionSaveBtn" :busy="saving.busy.value" @click="save">保存栏目</BusyBtn>
      </div>
    </div>
  </Modal>
</template>

<script setup>
/* 内容栏目管理：账号下的几条内容线（名称、讲什么、写作要点、默认框架、要作者提供的素材）。
 * 栏目列表在 studio.sections，简报里的栏目那一排读的也是它。 */
import { computed, nextTick, reactive, ref } from 'vue';
import Modal from './common/Modal.vue';
import BusyBtn from './common/BusyBtn.vue';
import { useStudioStore } from '../stores/studio.js';
import { useSectionsStore } from '../stores/sections.js';
import { api } from '../lib/api.js';
import { ask, toast } from '../lib/feedback.js';
import { useBusy } from '../lib/busy.js';

const s = useStudioStore();
const sec = useSectionsStore();
const open = computed({ get: () => sec.managerOpen, set: (v) => { sec.managerOpen = v; } });
const persona = computed(() => s.personas.find((p) => p.id === sec.personaId) || null);
const preset = ref('');
const nameBox = ref(null);
const rowsBox = ref(null);
const saving = useBusy();

/* 已经建过的栏目，预设里不再列 */
const presets = computed(() => {
  const used = new Set(s.sections.map((x) => x.name));
  return s.presets.filter((p) => !used.has(p.name));
});

let uid = 0;
const form = reactive({ open: false, id: null, name: '', purpose: '', guide: '', framework: '', fields: [], error: '' });
const fwMine = ref([]);
const fwBuiltin = ref([]);

async function loadFrameworks() {
  try {
    const { builtin, mine } = await api('/frameworks');
    fwBuiltin.value = builtin;
    fwMine.value = mine;
  } catch { /* 拉不到就只能不指定 */ }
}

function openForm(values, id = null) {
  form.id = id;
  form.name = values.name || '';
  form.purpose = values.purpose || '';
  form.guide = values.guide || '';
  form.framework = values.default_framework || '';
  form.fields = (values.fields || []).map((f) => ({ uid: ++uid, label: f.label || '', hint: f.hint || '', required: Boolean(f.required) }));
  form.error = '';
  form.open = true;
  loadFrameworks();
  nextTick(() => nameBox.value?.focus());
}

function add() {
  const p = s.presets.find((x) => x.name === preset.value);
  openForm(p ? { ...p } : { name: '', purpose: '', guide: '' });
}

function addField() {
  if (form.fields.length >= 8) { toast('一个栏目最多 8 项素材'); return; }
  form.fields.push({ uid: ++uid, label: '', hint: '', required: false });
  nextTick(() => rowsBox.value?.querySelector('.field-row:last-child .lbl')?.focus());
}

async function removeField(i) {
  const label = form.fields[i]?.label.trim();
  if (!await ask.confirm({
    title: label ? `删掉「${label}」这项？` : '删掉这项？',
    body: '还没保存的填写会一起去掉。',
    ok: '删除', danger: true,
  })) return;
  form.fields.splice(i, 1);
}

async function del(x) {
  if (!await ask.confirm({
    title: `删除栏目「${x.name}」？`,
    body: x.draft_count ? `其下 ${x.draft_count} 篇创作会保留。` : '',
    ok: '删除', danger: true,
  })) return;
  try {
    const { sections } = await api(`/personas/${sec.personaId}/sections/${x.id}`, { method: 'DELETE' });
    s.sections = sections;
  } catch (err) { toast(err.message); }
}

async function save() {
  const pid = sec.personaId;
  if (!pid) return;
  const body = {
    name: form.name.trim(),
    purpose: form.purpose.trim(),
    guide: form.guide.trim(),
    fields: form.fields.map((f) => ({ label: f.label.trim(), hint: f.hint.trim(), required: f.required })).filter((f) => f.label),
    default_framework: form.framework || '',
  };
  await saving.run(async () => {
    try {
      const { sections } = await api(form.id ? `/personas/${pid}/sections/${form.id}` : `/personas/${pid}/sections`,
        { method: form.id ? 'PUT' : 'POST', body });
      s.sections = sections;
      form.open = false;
    } catch (err) { form.error = err.message; }
  });
}

function closed() {
  form.open = false;
  sec.closed();
}
</script>
