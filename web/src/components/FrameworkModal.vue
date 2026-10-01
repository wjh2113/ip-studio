<template>
  <Modal id="fwModal" v-model:open="fw.libOpen" title="框架库" sub="写法的结构：每段干什么、各占多少篇幅" size="fw-modal" close-id="fwClose">
    <div class="fw-bar">
      <div class="fw-tabs" id="fwTabs">
        <button v-for="t in TABS" :key="t.key" type="button" :data-tab="t.key" :class="{ on: tab === t.key }" @click="tab = t.key">{{ t.label }}</button>
      </div>
      <select id="fwPlatform" v-model="platform">
        <option value="">全部平台</option>
        <option v-for="p in fw.platforms" :key="p.key" :value="p.key">{{ p.label }}</option>
      </select>
      <button type="button" class="btn ghost small" id="fwExtractBtn" @click="openExtract">从范文拆解</button>
      <button type="button" class="btn primary small" id="fwNewBtn" @click="openEditor(null)">＋ 新建框架</button>
    </div>

    <div v-if="panel === 'extract'" class="fw-extract" id="fwExtract">
      <p class="hint">贴一篇你觉得写得好的文案（自己的爆款、收藏的范文都行），拆出它的结构。只拆结构不拆内容；原文会随框架保存，用来检查以后的稿子有没有和它雷同。</p>
      <textarea id="fwSource" rows="8" maxlength="8000" v-model="source" placeholder="粘贴范文，至少 150 字" ref="sourceBox"></textarea>
      <div class="fw-bar">
        <label class="btn ghost small fw-file">读取 .txt / .md 文件<input type="file" id="fwFile" accept=".txt,.md,text/plain,text/markdown" hidden @change="readFile" /></label>
        <select id="fwSourcePlatform" v-model="sourcePlatform">
          <option value="">范文所在平台（选填）</option>
          <option v-for="p in fw.platforms" :key="p.key" :value="p.key">{{ p.label }}</option>
        </select>
        <span class="hint" id="fwSourceCount">{{ source.trim() ? `${source.trim().length} 字` : '' }}</span>
        <span class="grow"></span>
        <button type="button" class="btn ghost small" id="fwExtractCancel" @click="panel = 'list'">取消</button>
        <BusyBtn class="btn primary small" id="fwExtractRun" :busy="extracting.busy.value" @click="extract">拆解</BusyBtn>
      </div>
    </div>

    <div v-if="panel === 'list'" class="fw-list" id="fwList">
      <p v-if="listError" class="form-error">{{ listError }}</p>
      <p v-else-if="!fw.all" class="hint">加载中…</p>
      <p v-else-if="!visible.length" class="hint">{{ tab === 'mine' ? '还没有自己的框架。可以新建，也可以把内置的复制过来再改。' : '这个平台下没有框架。' }}</p>
      <div v-for="f in visible" :key="f.key" class="fw-card" :class="{ on: s.frameworkKey === f.key }" :data-key="f.key">
        <div class="fw-card-head">
          <b>{{ f.name }}</b>
          <span class="fw-tag">{{ f.builtin ? '内置' : '我的' }}</span>
          <span class="fw-tag">{{ f.platforms.length ? f.platforms.map(fw.platformLabel).join(' / ') : '通用' }}</span>
          <span v-if="f.source_chars" class="fw-tag" title="从范文拆出来的：用它写的稿子会查和范文的重合">有范文</span>
          <span v-if="f.used_count" class="hint">用过 {{ f.used_count }} 次</span>
        </div>
        <p v-if="f.summary" class="fw-sum">{{ f.summary }}</p>
        <SlotBar :slots="f.slots" />
        <div class="fw-actions">
          <button type="button" class="btn primary small" :data-use="f.key" @click="use(f)">{{ s.frameworkKey === f.key ? '正在用' : '用这个写' }}</button>
          <BusyBtn v-if="f.builtin" class="btn ghost small" :data-copy="f.key" :busy="copying === f.key" @click="copyBuiltin(f)">复制到我的</BusyBtn>
          <template v-else>
            <button type="button" class="btn ghost small" :data-edit="f.id" @click="openEditor(f)">编辑</button>
            <button type="button" class="btn ghost small" :data-del="f.id" @click="del(f)">删除</button>
          </template>
        </div>
      </div>
    </div>

    <div v-if="panel === 'editor'" class="fw-editor" id="fwEditor">
      <label class="full">框架名 <span class="req">*</span><input id="fwName" maxlength="30" v-model="ed.name" placeholder="例：我的种草五段式" ref="nameBox" /></label>
      <label class="full">一句话说明<input id="fwSummary" maxlength="200" v-model="ed.summary" placeholder="适合什么内容、为什么好用" /></label>
      <div class="fw-plats" id="fwPlats">
        <span class="sections-label">适用平台</span>
        <label v-for="p in fw.platforms" :key="p.key" class="fw-plat"><input type="checkbox" :value="p.key" v-model="ed.platforms" />{{ p.label }}</label>
        <span class="hint">都不勾 = 通用</span>
      </div>
      <label class="full">适用场景<input id="fwScenes" maxlength="60" v-model="ed.scenes" placeholder="用逗号分隔，例：种草，好物（推荐时会按它和题材匹配）" /></label>
      <div class="field-editor">
        <div class="field-editor-head">
          <span>段落（按顺序）</span>
          <button type="button" class="btn ghost small" id="fwSlotAdd" @click="addSlot">＋ 加一段</button>
        </div>
        <p class="hint">每段写清作用和要点，篇幅填百分比（会自动按比例换算，不必凑满 100）。</p>
        <div class="fw-slots" id="fwSlots">
          <div v-for="(x, i) in ed.slots" :key="x.uid" class="fw-slot">
            <input class="fw-role" maxlength="20" placeholder="这一段的作用，例：痛点开头" v-model="x.role" />
            <input class="fw-guide" maxlength="200" placeholder="要点：这段该写什么、怎么写" v-model="x.guide" />
            <input class="fw-ratio" type="number" min="1" max="100" step="1" v-model="x.ratio" title="篇幅占比 %" /><span class="hint">%</span>
            <button type="button" class="icon-btn" data-up title="上移" @click="move(i, -1)">↑</button>
            <button type="button" class="icon-btn" data-down title="下移" @click="move(i, 1)">↓</button>
            <button type="button" class="icon-btn" data-rm title="删掉这段" @click="ed.slots.splice(i, 1)">×</button>
          </div>
        </div>
        <div class="fw-bar-preview" id="fwPreview"><SlotBar v-if="previewSlots.length" :slots="previewSlots" /></div>
      </div>
      <p v-if="ed.why" class="hint" id="fwWhy">为什么有效：{{ ed.why }}</p>
      <p class="form-error" id="fwError">{{ error }}</p>
      <div class="section-form-foot">
        <button class="btn ghost small" type="button" id="fwCancel" @click="panel = 'list'">取消</button>
        <BusyBtn class="btn primary small" id="fwSave" :busy="saving.busy.value" @click="save">保存框架</BusyBtn>
      </div>
    </div>
  </Modal>
</template>

<script setup>
import { computed, nextTick, reactive, ref, watch } from 'vue';
import Modal from './common/Modal.vue';
import BusyBtn from './common/BusyBtn.vue';
import SlotBar from './SlotBar.vue';
import { useFrameworksStore } from '../stores/frameworks.js';
import { useStudioStore } from '../stores/studio.js';
import { ask, toast } from '../lib/feedback.js';
import { useBusy } from '../lib/busy.js';
import { api } from '../lib/api.js';
import { useBriefStore } from '../stores/brief.js';

const fw = useFrameworksStore();
const s = useStudioStore();
const brief = useBriefStore();

const TABS = [{ key: 'all', label: '全部' }, { key: 'mine', label: '我的' }, { key: 'builtin', label: '内置' }];
const tab = ref('all');
const platform = ref('');
const panel = ref('list');          // list | editor | extract
const listError = ref('');
const copying = ref('');
const nameBox = ref(null);
const sourceBox = ref(null);

/* 每次打开都重新拉：使用次数、别处的增删都要反映出来 */
watch(() => fw.libOpen, async (open) => {
  if (!open) return;
  panel.value = 'list';
  listError.value = '';
  platform.value = brief.form.platform || '';
  try { await fw.loadAll(); } catch (err) { listError.value = err.message; }
});

const visible = computed(() => {
  const p = platform.value;
  const mine = fw.all?.mine || [];
  const builtin = fw.all?.builtin || [];
  const pool = tab.value === 'mine' ? mine : tab.value === 'builtin' ? builtin : [...mine, ...builtin];
  // 选了平台时，该平台专用的排在通用的前面；「我的」始终在前
  const rank = (f) => (f.builtin ? 2 : 0) + (p && f.platforms.includes(p) ? 0 : 1);
  return pool.filter((f) => !p || !f.platforms.length || f.platforms.includes(p))
    .map((f, i) => ({ f, i })).sort((a, b) => rank(a.f) - rank(b.f) || a.i - b.i).map((x) => x.f);
});

function use(f) {
  fw.choose(f);
  fw.libOpen = false;
  toast(`本篇按「${f.name}」的结构写`);
}

async function copyBuiltin(f) {
  copying.value = f.key;
  try {
    const framework = await fw.copy(f.key);
    tab.value = 'mine';
    openEditor(framework);
  } catch (err) { toast(err.message); } finally { copying.value = ''; }
}

async function del(f) {
  if (!await ask.confirm({ title: `删除框架「${f.name}」？`, body: '用它写过的稿子不受影响。', danger: true, ok: '删除' })) return;
  try { await fw.remove(f); } catch (err) { toast(err.message); }
}

/* ---------- 编辑 ---------- */
let uid = 0;
const ed = reactive({ id: null, name: '', summary: '', scenes: '', platforms: [], slots: [], source: null, why: '' });
const error = ref('');
const saving = useBusy();

const pct = (r) => Math.round(r * 100);

function openEditor(f = null, { source = null, why = '' } = {}) {
  ed.id = f?.id || null;
  ed.source = source;                 // 从范文拆出来的新框架：保存时带上原文
  ed.why = why;
  ed.name = f?.name || '';
  ed.summary = f?.summary || '';
  ed.scenes = (f?.scenes || []).join('，');
  ed.platforms = [...(f?.platforms || [])];
  const slots = f?.slots?.length ? f.slots : [
    { role: '开头', guide: '', ratio: 0.15 }, { role: '主体', guide: '', ratio: 0.7 }, { role: '结尾', guide: '', ratio: 0.15 },
  ];
  ed.slots = slots.map((x) => ({ uid: ++uid, role: x.role, guide: x.guide || '', ratio: pct(x.ratio) || 20 }));
  error.value = '';
  panel.value = 'editor';
  nextTick(() => nameBox.value?.focus());
}

function addSlot() {
  if (ed.slots.length >= 10) { error.value = '最多 10 段'; return; }
  ed.slots.push({ uid: ++uid, role: '', guide: '', ratio: 20 });
}

function move(i, d) {
  const j = i + d;
  if (j < 0 || j >= ed.slots.length) return;
  const [x] = ed.slots.splice(i, 1);
  ed.slots.splice(j, 0, x);
}

const readSlots = () => ed.slots
  .map((x) => ({ role: String(x.role).trim(), guide: String(x.guide).trim(), ratio: Number(x.ratio) || 0 }))
  .filter((x) => x.role);

const previewSlots = computed(() => {
  const slots = readSlots();
  const total = slots.reduce((n, x) => n + x.ratio, 0) || 1;
  return slots.map((x) => ({ ...x, ratio: x.ratio / total }));
});

async function save() {
  const body = {
    name: ed.name.trim(),
    summary: ed.summary.trim(),
    scenes: ed.scenes,
    platforms: [...ed.platforms],
    slots: readSlots(),
  };
  if (ed.source) body.source_text = ed.source;
  if (!body.name) { error.value = '给框架起个名字'; return; }
  if (body.slots.length < 2) { error.value = '至少要有 2 段'; return; }
  await saving.run(async () => {
    try {
      await fw.save(ed.id, body);
      panel.value = 'list';
      toast('框架已保存');
    } catch (err) { error.value = err.message; }
  });
}

/* ---------- 从范文拆解 ---------- */
const source = ref('');
const sourcePlatform = ref('');
const extracting = useBusy();

function openExtract() {
  panel.value = 'extract';
  sourcePlatform.value = brief.form.platform || '';
  nextTick(() => sourceBox.value?.focus());
}

async function readFile(e) {
  const f = e.target.files?.[0];
  e.target.value = '';
  if (!f) return;
  if (f.size > 200 * 1024) { toast('文件太大，范文请控制在 8000 字以内'); return; }
  source.value = (await f.text()).slice(0, 8000);
}

async function extract() {
  const text = source.value.trim();
  if (text.length < 150) { toast('范文至少 150 字才拆得出结构'); return; }
  await extracting.run(async () => {
    try {
      const { framework } = await api('/frameworks/extract', { method: 'POST', body: { text, platform: sourcePlatform.value } });
      openEditor(framework, { source: framework.source_text || text, why: framework.why });
    } catch (err) { toast(err.message); }
  });
}
</script>
