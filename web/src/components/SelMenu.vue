<template>
<div class="pop-menu sel-menu" id="selMenu" ref="box" :class="{ hidden: !m }" :style="pos">
  <!-- 改写只出一键动作；想按自己的意思改，点「问 AI」带着这段去右栏对话。加粗、颜色、列表在顶栏工具条 -->
  <div class="sel-acts">
    <button v-for="a in acts" :key="a.key" type="button" :data-action="a.key" @mousedown.prevent @click="pick(a)">{{ a.label }}</button>
    <!-- 带着这段去右栏对话：「这段」就指它 -->
    <button type="button" class="sel-ask" id="selAskBtn" data-action="ask" @mousedown.prevent @click="askAi">问 AI：说说怎么改</button>
  </div>
  <!-- 我的技能：自己存的改稿要求，对选中这段一键用 -->
  <div class="sel-skills" id="selSkills">
    <span class="sel-skills-head">我的技能</span>
    <button v-for="x in sk.list.slice(0, 8)" :key="x.id" type="button" :data-skill="x.id" :title="x.description || x.name" @mousedown.prevent @click="useSkill(x)"><Icon name="bolt" :size="12" />{{ x.name }}</button>
    <button v-if="sk.list.length > 8" type="button" class="sel-skill-add" id="selSkillMore" title="全部技能" @mousedown.prevent @click="openLib">更多…</button>
    <button type="button" class="sel-skill-add" id="selSkillAdd" title="把常用的改稿要求做成技能" @mousedown.prevent @click="addSkill"><Icon name="plus" :size="12" />{{ sk.list.length ? '新建' : '做一个常用的改稿要求' }}</button>
  </div>
</div>
</template>

<script setup>
import { computed, nextTick, ref, watch } from 'vue';
import { ASSIST_ACTIONS, useEditorStore } from '../stores/editor.js';
import { placeNear } from '../lib/caret.js';
import { useChatStore } from '../stores/chat.js';
import { useSkillsStore } from '../stores/skills.js';
import Icon from './common/Icon.vue';

const ed = useEditorStore();
const m = computed(() => ed.menus.sel);
const box = ref(null);
const pos = ref({});

const acts = ASSIST_ACTIONS;
const sk = useSkillsStore();

watch(m, async (v) => {
  if (!v) return;
  void sk.load();
  await nextTick();
  pos.value = placeNear(box.value, v);
});

function pick(a) {
  const target = m.value?.target;
  ed.menus.sel = null;
  if (target) ed.runAssist({ action: a.key, kind: 'rewrite', target }, a.label);
}

function useSkill(x) {
  const target = m.value?.target;
  ed.menus.sel = null;
  sk.runOn(target, x);
}

function addSkill() {
  ed.menus.sel = null;
  sk.openPage(null);          // 整页新建；建好后回来选中那段再点它
}

function openLib() {
  ed.menus.sel = null;
  sk.lib.open = true;
}

function askAi() {
  const target = m.value?.target;
  ed.menus.sel = null;
  if (target?.text) useChatStore().open({ quote: target.text });
}

</script>
