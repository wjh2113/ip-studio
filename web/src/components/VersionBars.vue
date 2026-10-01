<template>
  <div class="version-bars">
    <!-- 多平台：勾平台 → 一个一个生成（失败就停）。走的是适配改写，不是各平台各生成一遍——否则同一件事会变成几个不同的故事 -->
    <div v-if="v.multi.open && s.draft?.content" class="multi-bar" id="multiBar">
      <div class="multi-pick" id="multiPick">
        <label v-for="p in v.multiOptions" :key="p.key" :class="{ done: p.made }">
          <input type="checkbox" :value="p.key" v-model="v.multi.picked">
          {{ p.label }}<em>{{ p.made ? '已生成 · 勾上重做' : `${p.length}字` }}</em>
        </label>
      </div>
      <div class="multi-acts">
        <span class="hint" id="multiHint">{{ v.multi.hint }}</span>
        <span class="grow"></span>
        <BusyBtn class="btn primary small" id="multiRunBtn" :busy="v.multi.running" @click="v.runMulti()">生成选中的版本</BusyBtn>
      </div>
    </div>

    <!-- 版本切换条：原文和各平台版本平级放 -->
    <div v-if="v.tabs.length" class="ver-tabs" id="verTabs">
      <button v-for="t in v.tabs" :key="t.key" :data-ver="t.key" :class="{ on: v.current === t.key, stale: t.stale }"
        :title="t.stale ? '正文在这一版之后改过，内容可能对不上了——重做一次' : null" @click="v.switchTo(t.key)">{{ t.label }}<i>{{ t.stale ? '需重做' : `${t.chars}字` }}</i></button>
    </div>

    <!-- 配图挂在版本上：切版本 = 换一套配图 -->
    <div v-if="v.ill.open" class="illus-bar" id="illusBar">
      <span class="chip" id="illusChip" :class="{ warn: v.ill.info && !v.ill.info.live }">{{ v.ill.info?.label || '' }}</span>
      <span class="hint" id="illusHint">{{ hint }}</span>
      <span class="grow"></span>
      <BusyBtn class="btn ghost small" id="illusPlanBtn" :busy="v.ill.planning" @click="v.planIllus()">{{ v.markCount ? `按 ${Math.min(v.markCount, 8)} 处指定位置排版` : '重新排版位' }}</BusyBtn>
      <BusyBtn class="btn primary small" id="illusRunBtn" :busy="v.ill.runningAll" @click="v.runAllIllus()">全部出图</BusyBtn>
      <div class="illus-list" id="illusList">
        <div v-for="it in v.illus?.items || []" :key="it.i" class="illus-row">
          <img v-if="it.image" :src="imageUrl(it.image)" alt="">
          <div v-else class="ph">未出图</div>
          <div class="body">
            <div class="where">插在「{{ it.anchor.slice(0, 16) }}…」之后<template v-if="it.alt"> · 图注：{{ it.alt }}</template></div>
            <!-- 改提示词只改本地，点出图时才带过去——避免每敲一下就打一次接口 -->
            <textarea :data-ill="it.i" rows="2" v-model.lazy="it.prompt"></textarea>
          </div>
          <button v-if="v.imageRunning(it.i)" class="mini" :data-illimg="it.i" disabled>出图中…</button>
          <button v-else class="mini" :data-illimg="it.i" @click="v.makeIllus(it.i)">{{ it.image ? '重出' : '出这张' }}</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import BusyBtn from './common/BusyBtn.vue';
import { useStudioStore } from '../stores/studio.js';
import { imageUrl, useVersionsStore } from '../stores/versions.js';

const s = useStudioStore();
const v = useVersionsStore();

const hint = computed(() => {
  if (v.ill.hint) return v.ill.hint;
  const store = v.illus;
  if (!store) return v.ill.planning ? '正在排版位…' : '';
  const done = store.items.filter((i) => i.image).length;
  return `${store.items.length} 张 · 已出 ${done}`
    + (store.capped ? ` · 模型给了 ${store.capped.asked} 个位置，按字数砍到 ${store.capped.cap}` : '')
    + (store.look ? ` · ${store.look}` : '');
});
</script>
