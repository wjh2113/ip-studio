<template>
  <fieldset class="subsection" id="profileSection">
    <!-- 个人档案：作者本人的工作、项目经历和观点。跟着人走，所有账号共用；写作时按题材召回，是第一人称取材唯一可信的来源 -->
    <legend>个人档案<span>你的工作经历、项目经历和一贯观点——所有账号共用，写作时按题材挑相关的几条</span></legend>

    <!-- 贴简历拆解 -->
    <div class="pf-parse">
      <div class="pf-parse-head"><Icon name="wand" :size="15" /><b>贴一段简历或经历回顾（或者直接选 Word / PDF 简历），帮你拆成一条条</b><span class="hint">拆完你勾选、改好再存；写了公司名的默认「只作背景」，写作时不点名</span></div>
      <textarea id="profileParseText" v-model="L.parse.text" rows="5" maxlength="12000"
        placeholder="例：2019-2022 在一家电商公司做运营主管，带 5 个人的小组。那年双十一把转化率从 2% 拉到 3.5%……"></textarea>
      <div class="pf-row">
        <label class="btn ghost small imp-file" :class="{ busy: L.parse.reading }"><Icon name="doc" :size="13" />{{ L.parse.reading ? '正在读…' : '选简历文件' }}<input id="profileResumeFile" type="file" accept=".docx,.pdf,.md,.txt" class="sr-only" @change="L.pickResume($event.target.files[0]); $event.target.value = ''" /></label>
        <BusyBtn class="btn primary small" id="profileParseBtn" :busy="L.parse.running" busy-text="正在拆…" @click="L.runParse()">拆成条目</BusyBtn>
        <span class="form-error">{{ L.parse.error }}</span>
      </div>
      <div v-if="L.parse.candidates.length" class="pf-cands" id="profileCandidates">
        <label v-for="(c, i) in L.parse.candidates" :key="i" class="pf-cand" :class="{ off: !c.pick }">
          <input v-model="c.pick" type="checkbox" />
          <span class="pf-kind" :data-kind="c.kind">{{ PROFILE_KIND[c.kind] }}</span>
          <span class="grow">
            <input v-model="c.title" class="pf-cand-title" maxlength="60" @keydown.enter.prevent />
            <small>{{ [c.period, c.org, c.role].filter(Boolean).join(' · ') }}{{ c.result ? `　结果：${c.result}` : '' }}</small>
          </span>
          <select v-model="c.visibility" title="写作时能不能点名机构">
            <option value="public">可公开</option>
            <option value="background">只作背景</option>
          </select>
        </label>
        <div class="pf-row">
          <button type="button" class="btn primary small" id="profileSaveParsed" @click="L.saveParsed()">存进档案（{{ picked }} 条）</button>
          <button type="button" class="btn ghost small" @click="L.parse.candidates = []">不要了</button>
        </div>
      </div>
    </div>

    <!-- 列表 -->
    <div class="pf-toolbar">
      <b>已有 {{ L.profile.entries.length }} 条</b>
      <span class="grow"></span>
      <button v-for="(label, k) in PROFILE_KIND" :key="k" type="button" class="btn ghost small" :data-new-kind="k" @click="L.startNew(k)"><Icon name="plus" :size="13" />{{ label }}</button>
    </div>

    <ProfileEntryForm v-if="L.editing === 'new'" />
    <p v-if="!L.profile.entries.length && L.editing !== 'new'" class="hint pf-empty">还没有经历。贴一段简历拆一下最快，或者点上面的按钮一条条加。</p>

    <div class="pf-list" id="profileList">
      <template v-for="e in L.profile.entries" :key="e.id">
        <ProfileEntryForm v-if="L.editing === e.id" />
        <div v-else class="pf-item" :data-profile="e.id">
          <div class="pf-item-head">
            <span class="pf-kind" :data-kind="e.kind">{{ PROFILE_KIND[e.kind] }}</span>
            <b>{{ e.title }}</b>
            <span v-if="e.visibility === 'background'" class="pf-bg" title="写作时不写出机构名">只作背景</span>
            <span class="grow"></span>
            <span v-if="e.used_count" class="pf-used">写作用过 {{ e.used_count }} 次</span>
            <button type="button" class="mini" :data-edit-profile="e.id" @click="L.startEdit(e)">改</button>
            <button type="button" class="mini del" :data-del-profile="e.id" @click="L.removeEntry(e)">删</button>
          </div>
          <p v-if="meta(e)" class="pf-meta">{{ meta(e) }}</p>
          <p v-if="e.body">{{ e.body }}</p>
          <p v-if="e.result" class="pf-result"><b>结果</b>{{ e.result }}</p>
        </div>
      </template>
    </div>
    <p class="hint">{{ L.profile.error || `最多 ${L.profile.max} 条。档案里没有的经历，AI 写稿时不会替你编。` }}</p>
  </fieldset>
</template>

<script setup>
import { computed, onMounted } from 'vue';
import BusyBtn from './common/BusyBtn.vue';
import Icon from './common/Icon.vue';
import ProfileEntryForm from './ProfileEntryForm.vue';
import { PROFILE_KIND, useLearningStore } from '../stores/learning.js';

const L = useLearningStore();
const picked = computed(() => L.parse.candidates.filter((c) => c.pick).length);
const meta = (e) => [e.period, e.org, e.role].filter(Boolean).join(' · ');

onMounted(() => L.loadProfile());
</script>
