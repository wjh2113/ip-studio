<template>
<div class="account-page skill-page" id="skillPage" :class="{ hidden: !p.open }" @keydown.meta.s.prevent="save" @keydown.ctrl.s.prevent="save">
  <div class="acc-form">
    <header class="acc-head">
      <div class="brand"><span class="brand-mark" aria-hidden="true"></span><span>自媒体助手</span></div>
      <button class="acc-back" type="button" id="skillBackBtn" title="返回" @click="sk.closePage()"><Icon name="arrow-left" :size="15" />返回</button>
      <h2>技能</h2>
      <span v-if="sk.dirty" class="skill-unsaved">未保存</span>
      <span class="grow"></span>
      <template v-if="p.id">
        <button type="button" class="btn ghost small" id="skillCopyBtn" @click="copyThis"><Icon name="copy" :size="13" />复制</button>
        <button type="button" class="btn ghost small" id="skillDelBtn" @click="delThis"><Icon name="trash" :size="13" />删除</button>
      </template>
      <BusyBtn type="button" class="btn primary small" id="skillSaveBtn" :busy="p.saving" busy-text="保存中" @click="save">{{ p.id ? '保存' : '建好技能' }}</BusyBtn>
    </header>

    <div class="skill-scroll">
      <p v-if="p.loading" class="hint skill-col">加载中…</p>
      <div v-else class="skill-col">
        <input id="skillName" ref="nameEl" v-model="d.name" class="skill-title" maxlength="30" placeholder="新建技能" @keydown.enter.prevent="bodyEl?.focus()" />

        <!-- 属性：像 Notion 页面顶上的那几行 -->
        <div class="skill-props">
          <div class="skill-prop">
            <span class="skill-prop-k"><Icon name="list" :size="15" />描述</span>
            <input id="skillDesc" v-model="d.description" maxlength="120" placeholder="空白：一句话说清什么时候用" />
          </div>
          <div class="skill-prop">
            <span class="skill-prop-k"><Icon name="tag" :size="15" />标签</span>
            <div class="skill-tags">
              <span v-for="(t, i) in d.tags" :key="t" class="skill-chip">{{ t }}<button type="button" :aria-label="`去掉标签 ${t}`" @click="d.tags.splice(i, 1)"><Icon name="x" :size="11" /></button></span>
              <input v-if="d.tags.length < 8" id="skillTagInput" v-model="tagText" maxlength="12" :placeholder="d.tags.length ? '' : '空白：回车加一个'"
                @keydown.enter.prevent="addTag" @keydown="onTagKey" @blur="addTag" />
            </div>
          </div>
          <div class="skill-prop">
            <span class="skill-prop-k"><Icon name="link" :size="15" />参考资料</span>
            <div class="skill-refs">
              <span v-for="(r, i) in d.refs" :key="i" class="skill-chip" :class="{ missing: r.missing }" :title="r.type === 'text' ? r.text.slice(0, 200) : r.title">
                <Icon :name="r.type === 'text' ? 'doc' : 'folder'" :size="12" />{{ r.title }}
                <button type="button" :aria-label="`去掉 ${r.title}`" @click="d.refs.splice(i, 1)"><Icon name="x" :size="11" /></button>
              </span>
              <template v-if="d.refs.length < 5">
                <button type="button" class="link-btn" id="skillRefMaterial" @click="togglePicker">从素材库挑</button>
                <button type="button" class="link-btn" id="skillRefText" @click="sk.addTextRef()">贴一段范文</button>
              </template>
              <span v-if="!d.refs.length" class="skill-empty">空白：AI 用这个技能时会一起读，只学写法和口吻</span>
              <!-- 素材库挑选 -->
              <div v-if="picker" class="skill-picker" id="skillMaterialPicker">
                <input v-model="mq" placeholder="搜素材标题…" />
                <div class="skill-picker-list">
                  <button v-for="m in mats" :key="m.id" type="button" :data-material="m.id" @click="pickMaterial(m)">
                    <span class="mpick-tag">{{ m.kind }}</span>{{ m.title }}
                  </button>
                  <p v-if="!mats.length" class="hint">{{ sk.materials.length ? '没有匹配的素材' : '素材库是空的，先去「素材库」存几条' }}</p>
                </div>
              </div>
            </div>
          </div>
          <div class="skill-prop">
            <span class="skill-prop-k"><Icon name="shield" :size="15" />检查时也参考</span>
            <label class="skill-switch" title="打开后，成稿「检查」会把这个技能当作你的审稿要求：正文明显违反时报出来">
              <input id="skillInReview" v-model="d.inReview" type="checkbox" />
              <span>{{ d.inReview ? '开：「检查」会对照这个技能挑违反的地方' : '关：只在改稿时用' }}</span>
            </label>
          </div>
          <div class="skill-prop">
            <span class="skill-prop-k"><Icon name="user" :size="15" />创建者</span>
            <span class="skill-me"><span class="skill-avatar">{{ (sk.me || '我').slice(0, 1).toUpperCase() }}</span>{{ sk.me || '我' }}</span>
          </div>
          <div class="skill-prop">
            <span class="skill-prop-k"><Icon name="clock" :size="15" />最后修改</span>
            <span class="skill-muted">{{ p.updated_at ? fmt(p.updated_at) : '还没保存' }}</span>
          </div>
        </div>

        <div class="skill-sep"></div>

        <!-- 新建且正文空着：从模板开始 -->
        <div v-if="!p.id && !d.instruction.trim()" class="skill-templates" id="skillTemplates">
          <span class="skill-muted">直接在下面写，或从模板开始：</span>
          <button v-for="t in SKILL_TEMPLATES" :key="t.key" type="button" class="skill-tpl" :data-tpl="t.key" @click="useTemplate(t)">{{ t.name }}</button>
        </div>

        <textarea id="skillBody" ref="bodyEl" v-model="d.instruction" class="skill-body" maxlength="8000"
          placeholder="写清楚这个技能要怎么改稿：要改成什么样、按什么步骤、有哪些规则、不要什么，最好带一两个正反例子。支持 Markdown。"
          @input="grow"></textarea>
        <p class="skill-foot">
          <span>{{ d.instruction.length }} / 8000 字</span>
          <span>用的时候：划词菜单「我的技能」对选中那段用；AI 对话框「技能」一点就用。正文和参考资料会一起交给 AI。打开「检查时也参考」后，成稿检查也会对照它（最多 3 个技能）。⌘/Ctrl + S 保存。</span>
        </p>
      </div>
    </div>
  </div>
</div>
</template>

<script setup>
import { computed, nextTick, ref, watch } from 'vue';
import Icon from './common/Icon.vue';
import BusyBtn from './common/BusyBtn.vue';
import { SKILL_TEMPLATES, useSkillsStore } from '../stores/skills.js';
import { escStack } from '../lib/escape.js';

const sk = useSkillsStore();
const p = sk.page;
const d = computed(() => p.draft);
const nameEl = ref(null);
const bodyEl = ref(null);
const tagText = ref('');
const picker = ref(false);
const mq = ref('');

const fmt = (iso) => new Date(iso).toLocaleString('zh-CN', { hour12: false, month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const mats = computed(() => {
  const k = mq.value.trim().toLowerCase();
  const used = new Set(d.value.refs.filter((r) => r.type === 'material').map((r) => r.id));
  return sk.materials.filter((m) => !used.has(m.id) && (!k || String(m.title).toLowerCase().includes(k))).slice(0, 30);
});

function addTag() {
  const t = tagText.value.trim().replace(/[，,]$/, '');
  tagText.value = '';
  if (t && !d.value.tags.includes(t) && d.value.tags.length < 8) d.value.tags.push(t);
}
function onTagKey(e) {
  if (e.key === ',' || e.key === '，') { e.preventDefault(); addTag(); }
  else if (e.key === 'Backspace' && !tagText.value && d.value.tags.length) d.value.tags.pop();
}
async function togglePicker() {
  picker.value = !picker.value;
  if (picker.value) { mq.value = ''; await sk.loadMaterials(); }
}
function pickMaterial(m) { sk.addMaterialRef(m); if (d.value.refs.length >= 5) picker.value = false; }

function useTemplate(t) {
  if (!d.value.name.trim()) d.value.name = t.name;
  if (!d.value.description.trim()) d.value.description = t.description;
  for (const tag of t.tags) if (!d.value.tags.includes(tag)) d.value.tags.push(tag);
  d.value.instruction = t.instruction;
  nextTick(() => { grow(); bodyEl.value?.focus(); });
}

function grow() {
  const el = bodyEl.value;
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = `${Math.max(320, el.scrollHeight)}px`;
}

async function save() { if (await sk.savePage()) nextTick(grow); }
async function copyThis() {
  const x = await sk.copy(p.id);
  if (x) await sk.openPage(x.id);
}
async function delThis() { await sk.remove({ id: p.id, name: d.value.name }); }

const esc = escStack(() => p.open, () => sk.closePage());
watch(() => p.open, async (open) => {
  esc.toggle(open);
  document.body.classList.toggle('no-scroll', open || sk.lib.open);
  picker.value = false;
  if (!open) return;
  await nextTick();
  grow();
  (d.value.name ? bodyEl : nameEl).value?.focus();
}, { immediate: true });
watch(() => p.loading, (l) => { if (!l) nextTick(grow); });
</script>
