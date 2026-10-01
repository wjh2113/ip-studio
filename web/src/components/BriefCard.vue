<template>
  <section class="brief-layout" id="briefCard" :class="{ solo: !persona }">
    <!-- 第一步：左边是创作简报，右边是选题来源（选题池 + 推荐题材）。来源只在有账号时出现——没有账号就没有「这个号写过什么」 -->
    <div class="card brief-main">
      <div class="card-head">
        <h2>创作简报</h2>
        <span class="grow"></span>
        <span class="inherit-note" id="inheritNote" :class="{ free: noteFree }">{{ note }}</span>
      </div>
      <form id="briefForm" @submit.prevent="submit">
        <label class="full field">
          <span class="field-label">题材 <span class="req">*</span><em>写清楚想写什么、写给谁、重点是什么</em></span>
          <span class="area-wrap">
            <textarea name="subject" rows="3" maxlength="200" required v-model="f.subject" ref="subjectBox" @change="fw.loadRecs()"
              placeholder="自己写，或从右边挑一条"></textarea>
            <span class="area-count">{{ f.subject.length }} / 200</span>
          </span>
        </label>

        <!-- 内容栏目：账号下的几条内容线，选中的栏目要什么素材，就在这里问什么 -->
        <div v-if="persona" class="field" id="sectionPick">
          <span class="field-label">内容栏目<em>选一条内容线，生成会按它的目的和素材来写</em></span>
          <div class="chip-row">
            <div class="section-chips" id="sectionChips">
              <button type="button" class="section-chip" :class="{ on: s.sectionId === null }" data-section=""
                title="不指定栏目，按账号的通用定位写" @click="b.pickSection(null)">常规创作</button>
              <button v-for="x in s.sections" :key="x.id" type="button" class="section-chip" :class="{ on: s.sectionId === x.id }"
                :data-section="x.id" :title="x.purpose || ''" @click="b.pickSection(x.id)">{{ x.name }}<span v-if="x.draft_count" class="n">({{ x.draft_count }})</span></button>
            </div>
            <button type="button" class="section-chip manage" id="manageSectionsBtn" @click="sections.openManager()"><Icon name="gear" :size="14" />管理栏目</button>
          </div>
        </div>

        <div v-if="b.section?.fields?.length" class="section-inputs" id="sectionInputs" ref="inputsBox">
          <div class="section-inputs-head">
            <b>动态素材</b><span>（已选栏目：{{ b.section.name }}）</span>
            <span class="grow"></span>
            <span class="truth-note">模型只会用你填的，不会自己编</span>
          </div>
          <label v-for="x in b.section.fields" :key="x.label" class="si-row">
            <span class="lab">{{ x.label }}<template v-if="x.required"> <span class="req">*</span></template>
              <em v-if="x.hint">{{ x.hint }}</em></span>
            <textarea :data-input="x.label" rows="2" maxlength="1500" v-model="b.inputs[x.label]"></textarea>
          </label>
        </div>

        <FrameworkPick />

        <div v-if="b.pendingHotspot" class="field">
          <span class="field-label">借势热点<em>引用热点可提升曝光，内容要和热点真的有关</em></span>
          <div class="hot-ref" id="hotRef">
            <span class="hot-ref-tag"><Icon name="flame" :size="14" />借势热点</span>
            <div class="hot-ref-main">
              <span class="hot-ref-title"><a v-if="hot.url" :href="hot.url" target="_blank" rel="noopener noreferrer">{{ hot.title }}</a><template v-else>{{ hot.title }}</template></span>
              <span v-if="hot.summary" class="hot-ref-summary">概要：{{ hot.summary }}</span>
              <span v-else class="hot-ref-summary muted">没抓到原文概要，成稿里只会写到「最近大家在讨论」的程度</span>
            </div>
            <button type="button" class="btn ghost small" id="hotRefClear" title="不借势这条" @click="b.clearHotspot()">清除</button>
          </div>
        </div>

        <!-- 默认按账号设定走，只展示不可改；点「修改」才展开成表单 -->
        <div v-if="b.locked" class="inherited" id="inheritRow">
          <div class="inherited-facts" id="inheritFacts">
            <span v-for="[k, v] in facts" :key="k" class="inherited-fact"><b>{{ k }}</b><span v-if="v">{{ v }}</span><span v-else class="unset">未设定</span></span>
          </div>
          <button type="button" class="btn ghost small" id="editParamsBtn" @click="unlock"><Icon name="pen" :size="14" />修改</button>
        </div>

        <div v-show="!b.locked" class="grid param-grid" id="paramGrid">
          <label>发布平台<select name="platform" id="platformSel" v-model="f.platform" ref="platformBox" @change="b.syncLength()">
            <option v-for="p in s.meta?.platforms || []" :key="p.key" :value="p.key">{{ p.label }}</option>
          </select></label>
          <label>风格调性<select name="tone" id="toneSel" v-model="f.tone">
            <option v-for="t in s.meta?.tones || []" :key="t.key" :value="t.key" :title="t.hint">{{ t.key }}</option>
          </select></label>
          <label>目标读者<input name="audience" v-model="f.audience" maxlength="120" placeholder="例：一线城市上班族" /></label>
          <label>目标字数<input name="length" v-model="f.length" type="number" min="150" max="4000" step="50" /></label>
          <div v-if="persona" class="param-reset" id="paramReset">
            <button type="button" class="btn ghost small" id="resetParamsBtn" @click="resetParams"><Icon name="refresh" :size="14" />恢复账号设定</button>
          </div>
        </div>

        <label class="full field"><span class="field-label">必须覆盖的关键词 / 信息点<em>可留空</em></span>
          <input name="keywords" v-model="f.keywords" maxlength="300" placeholder="用逗号分隔" />
        </label>

        <div class="submit-row">
          <BusyBtn type="submit" class="btn primary lg" id="topicsBtn" :busy="b.submitting"><Icon name="sparkles" />生成三个话题方向</BusyBtn>
          <span class="hint" id="briefHint" :class="{ error: b.hint.error }">{{ b.hint.text || '会按你的简报，出 3 个角度不同的话题方向供你选' }}</span>
        </div>
      </form>
    </div>

    <aside v-if="persona" class="brief-side">
      <PoolBox />

      <div class="card ideas" id="ideas">
        <div class="side-head">
          <h3>推荐题材<em id="ideasNote">{{ b.ideas.list.some((i) => i.kind === 'hot') ? '热点优先，其余是这个号还没写过的' : '这个号还没写过的' }}</em></h3>
          <button class="btn ghost small" type="button" id="ideasRefresh" :disabled="b.ideas.loading" @click="b.refreshIdeas()"><Icon name="refresh" :size="14" />换一批</button>
        </div>
        <div class="ideas-list" id="ideasList">
          <template v-if="b.ideas.loading"><div v-for="i in 4" :key="i" class="idea-skeleton"></div></template>
          <div v-else-if="b.ideas.message && !b.ideas.list.length" class="ideas-state" :class="{ error: b.ideas.error }">{{ b.ideas.message }}</div>
          <template v-else>
            <button v-for="(i, n) in b.ideas.list" :key="n" type="button" class="idea" :class="{ 'from-hot': i.kind === 'hot' }"
              :data-idea="n" @click="b.useSubject(i.subject, i.hotspot || null)">
              <span v-if="i.kind === 'hot'" class="idea-tag">热点优先 · {{ i.hotspot?.platform }}{{ i.strength ? ` · 关联${i.strength}` : '' }}</span>
              <!-- 「＋」存进选题池，点卡片本身才是现在就写 -->
              <span class="idea-save" :data-save-idea="n" title="存进选题池，以后再写"
                @click.stop="b.addPool(i.subject, i.kind === 'hot' ? '热点' : '推荐', i.reason || '')"><Icon name="plus" :size="14" /></span>
              <b>{{ i.subject }}</b>
              <span v-if="i.reason" class="idea-reason">{{ i.reason }}</span>
              <template v-if="i.kind === 'hot' && i.hotspot">
                <span class="idea-origin"><Icon name="flame" :size="12" />{{ i.hotspot.title }}</span>
                <span v-if="i.hotspot.summary" class="idea-summary">{{ i.hotspot.summary }}</span>
                <span v-else class="idea-summary muted">抓不到原文概要，动笔前请点开原文看一眼</span>
              </template>
            </button>
          </template>
        </div>
        <p class="side-foot">点卡片直接用这个题材，＋ 存进选题池以后再写</p>
      </div>
    </aside>
  </section>
</template>

<script setup>
import { computed, nextTick, ref, watch } from 'vue';
import BusyBtn from './common/BusyBtn.vue';
import Icon from './common/Icon.vue';
import FrameworkPick from './FrameworkPick.vue';
import PoolBox from './PoolBox.vue';
import { useStudioStore } from '../stores/studio.js';
import { useBriefStore } from '../stores/brief.js';
import { useFrameworksStore } from '../stores/frameworks.js';
import { useSectionsStore } from '../stores/sections.js';
import { toast } from '../lib/feedback.js';

const s = useStudioStore();
const b = useBriefStore();
const fw = useFrameworksStore();
const sections = useSectionsStore();
const f = b.form;
const subjectBox = ref(null);
const platformBox = ref(null);
const inputsBox = ref(null);

const persona = computed(() => s.currentPersona);
const hot = computed(() => b.pendingHotspot || {});

/* 打开旧稿时说这篇基于哪个号；新建时说按当前账号 */
const note = computed(() => {
  if (b.draftNote) return b.draftNote.name ? `本稿基于账号「${b.draftNote.name}」的设定创作` : '本稿未绑定账号';
  return persona.value ? `本篇按账号「${persona.value.name}」的设定创作` : '未绑定账号 · 本篇不带账号语境';
});
const noteFree = computed(() => (b.draftNote ? !b.draftNote.name : !persona.value));

const facts = computed(() => [
  ['发布平台', s.platformLabel(f.platform)],
  ['风格调性', f.tone],
  ['目标读者', f.audience || persona.value?.audience || ''],
  ['目标字数', f.length ? `约 ${f.length} 字` : ''],
]);

function unlock() {
  b.locked = false;
  nextTick(() => platformBox.value?.focus());
}

function resetParams() {
  b.applyPersonaDefaults();
  toast('已恢复账号设定');
}

async function submit() {
  const r = await b.submit();
  if (r === 'missing') inputsBox.value?.querySelector('textarea[data-input]')?.focus();
}

// 栏目列表变了（换账号、删了栏目），选中的栏目不在了就回到常规创作
watch(() => [s.sections, persona.value], () => {
  if (!persona.value || !s.sections.some((x) => x.id === s.sectionId)) s.sectionId = null;
});

// 账号、栏目、平台变了：写法框架的推荐跟着换
watch(() => [s.personaId, s.sectionId, f.platform, s.user], () => { fw.loadRecs(); });

// 选了题材（推荐、选题池、热点带回来的）：光标放进题材框末尾
watch(() => b.focusSubject, async () => {
  await nextTick();
  const el = subjectBox.value;
  if (!el) return;
  el.focus();
  el.setSelectionRange(el.value.length, el.value.length);
});
</script>
