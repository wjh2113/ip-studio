<template>
  <fieldset class="subsection" id="meSection">
    <!-- AI 眼中的我：这个号学到了什么，都摊开给作者看，不认同的可以关、改、删 -->
    <legend>AI 眼中的我<span>这个号从你的文章、改稿和发布里学到的东西；不认同的随时关掉或删掉</span></legend>

    <div class="me-auto">
      <label class="me-switch">
        <input id="autoLearnToggle" type="checkbox" :checked="L.me.autoLearn" @change="L.setAutoLearn($event.target.checked)" />
        <span><b>自动学习</b>　稿子标成已发布（或第一次回填发布数据）时，自动把它加进语气样本，并从你的改稿里学习惯</span>
      </label>
      <p class="hint">每次自动学习会用掉一点额度（两三次短调用）。</p>
    </div>

    <!-- 待确认的经历 -->
    <div v-if="pending.length" class="me-block" id="meCandidates">
      <h4><Icon name="user" :size="15" />从你的文章里找到的经历和观点，要存进个人档案吗？</h4>
      <div v-for="x in pending" :key="x.id" class="me-cand" :data-cand-log="x.id">
        <p class="me-cand-title">{{ x.summary }}</p>
        <label v-for="(c, i) in x.detail?.candidates || []" :key="i" class="pf-cand">
          <input v-model="picks[`${x.id}:${i}`]" type="checkbox" />
          <span class="pf-kind" :data-kind="c.kind">{{ PROFILE_KIND[c.kind] }}</span>
          <span class="grow"><b>{{ c.title }}</b><small>原文：「{{ c.quote }}」</small></span>
        </label>
        <div class="pf-row">
          <button type="button" class="btn primary small" :data-accept="x.id" @click="accept(x)">存进个人档案</button>
          <button type="button" class="btn ghost small" :data-dismiss="x.id" @click="L.dismissCandidates(x)">都不要</button>
        </div>
      </div>
    </div>

    <!-- 语气档案 -->
    <div class="me-block">
      <h4><Icon name="mic" :size="15" />语气档案
        <span class="hint">学了 {{ L.me.samples.count }} 篇{{ L.me.digestUpdatedAt ? ` · 更新于 ${stamp(L.me.digestUpdatedAt)}` : '' }}</span></h4>
      <div class="digest-box" id="meDigest">{{ L.me.digest || '还没有语气档案。在「语气样本」里喂几篇你写的文章就有了。' }}</div>
      <div class="pf-row">
        <button type="button" class="btn ghost small" id="meRebuildBtn" :disabled="!L.me.samples.count" @click="L.rebuild()"><Icon name="refresh" :size="13" />从头梳理</button>
        <span class="hint">新样本会随时合并进来；再多 {{ L.me.samples.untilFull }} 篇会自动从头梳理一遍，以近期的写法为准。</span>
      </div>
    </div>

    <!-- 改稿习惯 -->
    <div class="me-block" id="mePrefs">
      <h4><Icon name="pen" :size="15" />改稿习惯<span class="hint">从你改 AI 初稿的动作里学到的，写稿时必须遵守；命中越多越靠前，写作时带前 12 条</span></h4>
      <p v-if="!L.me.prefs.length" class="hint">还没学到。改完一篇 AI 写的稿子并标成已发布，或者在成稿页点「喂给账号学习」，就会从你的改动里学。</p>
      <div v-for="p in L.me.prefs" :key="p.id" class="me-pref" :class="{ off: p.status === 'off' }" :data-pref="p.id">
        <label class="me-pref-on" :title="p.status === 'off' ? '已关闭，写作时不用' : '开着'">
          <input type="checkbox" :checked="p.status !== 'off'" @change="L.updateRule(p, { status: $event.target.checked ? 'on' : 'off' })" />
        </label>
        <span class="grow">
          <b>{{ p.rule }}</b>
          <small v-if="p.evidence">{{ p.evidence }}</small>
        </span>
        <span class="pf-used" title="被多少篇改稿印证过">×{{ p.hits }}</span>
        <button type="button" class="mini" @click="L.editRule(p)">改</button>
        <button type="button" class="mini del" @click="L.removeRule(p)">删</button>
      </div>
      <div class="pf-row">
        <input id="meNewRule" v-model="L.newRule" maxlength="80" placeholder="自己加一条，例：不用「赋能」「抓手」这类词" @keydown.enter.prevent="L.addRule()" />
        <button type="button" class="btn ghost small" id="meAddRule" @click="L.addRule()">添加</button>
      </div>
    </div>

    <!-- 学习记录 -->
    <div class="me-block" id="meLog">
      <h4><Icon name="clock" :size="15" />学习记录</h4>
      <p v-if="!history.length" class="hint">还没有记录。</p>
      <div v-for="x in history" :key="x.id" class="me-log" :data-log-kind="x.kind">
        <span class="me-log-when">{{ stamp(x.created_at) }}</span>
        <span class="grow">{{ x.summary }}
          <button v-if="x.kind === 'digest' && x.detail?.before" type="button" class="link-btn" @click="open[x.id] = !open[x.id]">{{ open[x.id] ? '收起' : '看前后对照' }}</button>
          <span v-if="open[x.id]" class="me-diff">
            <span><b>之前</b>{{ x.detail.before }}</span>
            <span><b>之后</b>{{ x.detail.after }}</span>
          </span>
          <span v-if="x.kind === 'prefs' && x.detail?.added?.length" class="me-log-rules">
            <em v-for="r in x.detail.added" :key="r.id">{{ r.rule }}</em>
          </span>
        </span>
      </div>
    </div>
    <p class="form-error">{{ L.me.error }}</p>
  </fieldset>
</template>

<script setup>
import { computed, reactive, watch } from 'vue';
import Icon from './common/Icon.vue';
import { PROFILE_KIND, useLearningStore } from '../stores/learning.js';
import { useAccountStore } from '../stores/account.js';
import { stamp } from '../lib/text.js';

const L = useLearningStore();
const a = useAccountStore();
const picks = reactive({});
const open = reactive({});

const pending = computed(() => L.me.log.filter((x) => x.kind === 'candidates' && !x.status));
const history = computed(() => L.me.log.filter((x) => x.kind !== 'candidates'));

/* 新出现的候选默认全选 */
watch(pending, (list) => {
  for (const x of list) (x.detail?.candidates || []).forEach((c, i) => { if (picks[`${x.id}:${i}`] === undefined) picks[`${x.id}:${i}`] = true; });
}, { immediate: true });

function accept(x) {
  const list = (x.detail?.candidates || []).filter((c, i) => picks[`${x.id}:${i}`]);
  L.acceptCandidates(x, list);
}

watch(() => [a.page.open, a.page.tab, a.page.id], ([isOpen, tab, id]) => {
  if (isOpen && tab === 'me' && id) L.loadMe(id);
}, { immediate: true });
</script>
