<template>
  <div id="hotView" :class="{ hidden: s.view !== 'hot' }">
    <section class="card">
      <div class="card-head">
        <h2>可蹭的热点</h2>
        <div class="card-actions">
          <span class="counter" id="hotMeta">{{ boardsAt }}</span>
          <BusyBtn class="btn primary small" id="hotRun" :busy="h.running === 'auto'" :disabled="!persona || Boolean(h.running)"
            @click="h.run({})">抓取并比对</BusyBtn>
        </div>
      </div>
      <p class="hot-intro" id="hotIntro">
        <template v-if="persona">抓取全网榜单，和「{{ persona.name }}」的定位逐条比对，只留下这个号真能接得住的，并给出蹭点和选题建议。</template>
        <template v-else>抓取全网榜单，和当前账号的定位逐条比对，只留下这个号真能接得住的，并给出蹭点和选题建议。</template>
        <em>比对只看得到榜单标题，看不到原文——动笔前请点开原文核实。伤亡、灾难、点名到个人的争议一律不推荐。</em>
      </p>
      <div class="sources" id="hotSources">
        <span v-for="x in sources" :key="x.label" class="source-pill" :class="x.ok ? 'ok' : 'bad'" :title="x.error || ''">
          {{ x.ok ? '●' : '○' }} {{ x.label }}{{ x.ok ? ` ${x.count}` : ' 抓取失败' }}
        </span>
      </div>
      <div class="matches" id="hotMatches">
        <div v-if="!persona" class="hot-note">先在左边选一个账号，热点才有比对的对象。</div>
        <template v-else-if="h.running"><div class="idea-skeleton"></div><div class="idea-skeleton"></div></template>
        <div v-else-if="h.runError" class="hot-note">{{ h.runError }}</div>
        <template v-else-if="r">
          <div class="hint" style="margin-bottom:4px">{{ when(r.at) }} 比对了 {{ r.total }} 条热点<template v-if="r.screened">　·　已挡掉 {{ r.screened }} 条不适合蹭的<span class="screened-peek" :title="screenedTip">（看类型）</span></template></div>
          <div v-if="!r.matches.length" class="hot-note">{{ r.note || '这一轮榜单里没有适合这个号蹭的热点。硬蹭不如不蹭，等下一轮。' }}</div>
          <article v-for="(m, idx) in r.matches" :key="idx" class="match" :class="{ strong: m.strength === '强' }">
            <div class="match-top">
              <span class="badge">{{ m.origin?.platform || '' }}</span>
              <span class="badge" :class="`s-${m.strength}`">关联度 {{ m.strength }}</span>
              <span v-if="m.origin?.heat" class="badge">热度 {{ heat(m.origin.heat) }}</span>
            </div>
            <div class="match-block">
              <b>原文章</b>
              <p><a v-if="m.origin?.url" :href="m.origin.url" target="_blank" rel="noopener noreferrer">{{ m.origin.title }}</a><template v-else>{{ m.origin?.title }}</template></p>
              <p v-if="m.origin?.summary" class="origin-summary">{{ m.origin.summary }}<em>{{ SUMMARY_SOURCE[m.origin.summarySource] || '' }}</em></p>
              <p v-else class="origin-summary muted">抓不到原文概要（平台反爬或需要 JS），动笔前请点开原文核实</p>
            </div>
            <div class="match-block"><b>蹭热点的点</b><p>{{ m.angle }}</p></div>
            <div class="match-block"><b>选题建议</b><p>{{ m.subject }}</p></div>
            <div v-if="m.caution" class="match-block caution"><b>注意分寸</b><p>{{ m.caution }}</p></div>
            <button class="btn primary small" :data-match="idx" @click="useMatch(m)">用这个题材去创作</button>
          </article>
        </template>
      </div>
    </section>

    <section class="card">
      <div class="card-head">
        <h2>抓到的原始榜单</h2>
        <div class="card-actions">
          <select id="boardFilter" v-model="pick">
            <option value="">全部平台（{{ h.boards?.items.length || 0 }} 条）</option>
            <option v-for="g in groups" :key="g" :value="g">{{ g }}</option>
          </select>
          <button class="btn ghost small" id="boardRefresh" @click="h.loadBoards(true)">重新抓取</button>
        </div>
      </div>
      <div class="board" id="boardList">
        <div v-if="h.boardsLoading" class="ideas-state">正在抓取榜单…</div>
        <div v-else-if="h.boardsError" class="ideas-state error">{{ h.boardsError }}</div>
        <template v-else>
        <div v-for="(it, i) in rows" :key="i" class="board-row">
          <span class="no">{{ i + 1 }}</span>
          <span class="plat">{{ it.platform }}</span>
          <a v-if="it.url" :href="it.url" target="_blank" rel="noopener noreferrer">{{ it.title }}</a>
          <span v-else style="flex:1">{{ it.title }}</span>
          <span class="heat">{{ heat(it.heat) }}</span>
        </div>
        </template>
      </div>
      <details class="manual">
        <summary>榜单抓不到？手动粘一份</summary>
        <p class="hint">一行一条，可以直接从任何热榜页面复制粘贴，前面的序号会自动去掉。</p>
        <textarea id="manualInput" rows="5" v-model="manual" placeholder="1. 某某热点&#10;2. 另一个热点&#10;3. ..."></textarea>
        <BusyBtn class="btn ghost small" id="manualRun" :busy="h.running === 'manual'" :disabled="!persona || Boolean(h.running)"
          @click="runManual">用这份榜单比对</BusyBtn>
      </details>
    </section>
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue';
import BusyBtn from './common/BusyBtn.vue';
import { useHotStore } from '../stores/hot.js';
import { useStudioStore } from '../stores/studio.js';
import { toast } from '../lib/feedback.js';
import { callLegacy } from '../lib/legacy.js';

const h = useHotStore();
const s = useStudioStore();
const pick = ref('');
const manual = ref('');

const SUMMARY_SOURCE = { board: '　来源：榜单摘要', article: '　来源：抓取原文后概括' };

const persona = computed(() => s.currentPersona);
const r = computed(() => h.result);
const sources = computed(() => r.value?.sources || h.boards?.sources || []);
const groups = computed(() => [...new Set((h.boards?.items || []).map((i) => i.platform))]);
const rows = computed(() => (h.boards?.items || []).filter((i) => !pick.value || i.platform === pick.value));
const boardsAt = computed(() => (h.boards?.at
  ? `榜单更新于 ${new Date(h.boards.at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}` : ''));
const screenedTip = computed(() => (r.value?.screenedSample || []).map((b) => `${b.risk}：${b.title}`).join('\n'));

const heat = (n) => (!n ? '' : n >= 10000 ? `${(n / 10000).toFixed(1)} 万` : String(n));
const when = (at) => new Date(at).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

// 进热点板块、或者在热点板块里换了账号：把这个号上次的结果和榜单摆出来
watch(() => [s.view, s.personaId], ([view]) => { if (view === 'hot') h.open(); });

function runManual() {
  const text = manual.value.trim();
  if (!text) { toast('先粘一份榜单'); return; }
  h.run({ manual: text });
}

/* 一键把选题带回创作简报，成稿会引用这条热点 */
function useMatch(m) {
  s.view = 'write';
  callLegacy('resetBrief');
  callLegacy('useSubject', m.subject, {
    title: m.origin?.title || '', url: m.origin?.url || '',
    platform: m.origin?.platform || '', summary: m.origin?.summary || '',
    summarySource: m.origin?.summarySource || 'none', angle: m.angle,
  });
  toast('已带回创作简报，成稿会引用这条热点');
}
</script>
