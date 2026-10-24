<template>
  <div class="mpick" ref="root">
    <!-- 对话框里的「技能」（像 Notion）：标题行右边是技能库和新建；下面搜索；点一个就用，笔是编辑 -->
    <button type="button" class="mpick-btn" id="chatSkillBtn" ref="btn" :class="{ open }" :disabled="disabled"
      aria-haspopup="menu" :aria-expanded="String(open)" title="我的技能：常用的改稿要求，一点就用" @click="toggle">
      <Icon name="bolt" :size="12" /><span class="mpick-btn-label">技能</span>
    </button>
    <div v-if="open" class="mpick-menu skill-menu" id="chatSkillMenu" ref="menu" role="menu"
      @keydown.esc.prevent.stop="close(true)" @keydown.down.prevent="move(1)" @keydown.up.prevent="move(-1)">
      <div class="skill-menu-head">
        <span>技能</span>
        <span class="grow"></span>
        <button type="button" class="icon-btn" id="chatSkillLib" title="技能库：全部技能，按标签筛选、复制" @click="openLib"><Icon name="book" :size="15" /></button>
        <button type="button" class="icon-btn" id="chatSkillAdd" title="新建技能" @click="addNew()"><Icon name="plus" :size="15" /></button>
      </div>
      <div class="skill-menu-search">
        <input id="chatSkillSearch" ref="searchEl" v-model="q" placeholder="搜索技能…" autocomplete="off"
          @keydown.enter.prevent="enterFirst" />
      </div>
      <div class="mpick-scroll">
        <div v-for="x in found" :key="x.id" class="skill-row" :data-skill="x.id">
          <button type="button" class="mpick-opt" role="menuitem" :title="x.description || x.name" @click="use(x)">
            <span class="mpick-auto-ic"><Icon name="file" :size="15" /></span>
            <span class="mpick-text">
              <span class="mpick-name"><b>{{ x.name }}</b><span v-for="t in x.tags.slice(0, 2)" :key="t" class="mpick-tag">{{ t }}</span></span>
              <span v-if="x.description" class="mpick-desc skill-desc">{{ x.description }}</span>
            </span>
          </button>
          <button type="button" class="icon-btn skill-edit" data-act="edit" title="编辑这个技能" @click="edit(x)"><Icon name="pen" :size="14" /></button>
        </div>
        <button v-if="!found.length || q.trim()" type="button" class="mpick-opt skill-new" id="chatSkillNew" @click="addNew(q.trim())">
          <span class="mpick-auto-ic"><Icon name="file" :size="15" /></span>
          <span class="mpick-text"><span class="mpick-name">{{ q.trim() ? `新建技能「${q.trim()}」` : '新建技能' }}</span></span>
          <Icon name="pen" :size="14" />
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, ref } from 'vue';
import Icon from './common/Icon.vue';
import { useSkillsStore } from '../stores/skills.js';
import { useChatStore } from '../stores/chat.js';

defineProps({ disabled: { type: Boolean, default: false } });

const sk = useSkillsStore();
const chat = useChatStore();
const open = ref(false);
const q = ref('');
const root = ref(null);
const btn = ref(null);
const menu = ref(null);
const searchEl = ref(null);
const found = computed(() => sk.search(q.value));

function onOutside(e) { if (!root.value?.contains(e.target)) close(); }
async function show() {
  open.value = true;
  q.value = '';
  void sk.load();
  document.addEventListener('mousedown', onOutside, true);
  await nextTick();
  searchEl.value?.focus();
}
function close(refocus = false) {
  open.value = false;
  document.removeEventListener('mousedown', onOutside, true);
  if (refocus) btn.value?.focus();
}
const toggle = () => (open.value ? close() : show());

/* ↑↓ 在搜索框和各项之间走 */
function move(step) {
  const items = [searchEl.value, ...(menu.value?.querySelectorAll('.mpick-opt') || [])].filter(Boolean);
  const i = items.indexOf(document.activeElement);
  items[(i + step + items.length) % items.length]?.focus();
}

/* 有引用就对引用的那段，没有就对整篇；整个技能（正文 + 参考资料）由服务端交给模型 */
function use(x) {
  close();
  chat.send('', { skill: { id: x.id, name: x.name } });
}
function enterFirst() {
  if (found.value[0]) use(found.value[0]);
  else addNew(q.value.trim());
}
function edit(x) { close(); sk.openPage(x.id); }
function addNew(name = '') { close(); sk.openPage(null, name ? { name } : null); }
function openLib() { close(); sk.lib.open = true; }

onBeforeUnmount(() => document.removeEventListener('mousedown', onOutside, true));
</script>
