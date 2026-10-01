<template>
  <div id="hotView" :class="{ hidden: s.view !== 'hot' }">
    <!-- 当前账号语境：设计图里比对是对着这个号的，先摆清楚 -->
    <section v-if="persona" class="card hot-persona">
      <div class="hot-persona-avatar" :data-tone="tone(persona.name)">{{ persona.name?.[0] || '·' }}</div>
      <div class="hot-persona-main">
        <div class="hot-persona-name">
          <b>{{ persona.name }}</b>
          <span class="hot-plat-chip" :data-plat="platKey(persona.platform)">{{ s.platformLabel(persona.platform) }}</span>
        </div>
        <p class="hot-persona-line">
          <span v-if="persona.content_focus"><em>定位</em>{{ persona.content_focus }}</span>
          <span v-if="persona.tone"><em>风格</em>{{ persona.tone }}</span>
          <span v-if="persona.audience"><em>用户</em>{{ persona.audience }}</span>
        </p>
      </div>
      <p class="hot-persona-tip">比对只看榜单标题；伤亡、灾难、点名到个人的争议会先挡掉。动笔前请点开原文核实。</p>
    </section>

    <section class="card hot-card">
      <div class="hot-head">
        <div class="hot-title">
          <h2><Icon name="flame" :size="22" />可蹭的热点</h2>
          <p class="hot-intro" id="hotIntro">
            <template v-if="persona">抓取全网榜单，和「{{ persona.name }}」的定位逐条比对，只留下这个号真能接得住的，并给出蹭点和选题建议。</template>
            <template v-else>抓取全网榜单，和当前账号的定位逐条比对，只留下这个号真能接得住的，并给出蹭点和选题建议。</template>
            <em>比对只看得到榜单标题，看不到原文——动笔前请点开原文核实。伤亡、灾难、点名到个人的争议一律不推荐。</em>
          </p>
        </div>
        <div class="hot-run">
          <BusyBtn class="btn primary" id="hotRun" :busy="h.running === 'auto'" :disabled="!persona || Boolean(h.running)"
            @click="h.run({})"><Icon name="refresh" :size="15" />抓取并比对</BusyBtn>
          <span class="counter" id="hotMeta">{{ boardsAt || (r ? when(r.at) : '') }}</span>
        </div>
      </div>

      <div class="sources" id="hotSources">
        <span v-for="x in sources" :key="x.label" class="source-pill" :class="x.ok ? 'ok' : 'bad'" :data-plat="platKey(x.label)" :title="x.error || ''">
          <span class="source-mark" aria-hidden="true">{{ platMark(x.label) }}</span>
          <b>{{ x.label }}</b>
          <i>{{ x.ok ? '成功' : '失败' }}</i>
          <span>{{ x.ok ? `${x.count} 条` : '抓取失败' }}</span>
        </span>
        <span v-if="!sources.length" class="source-empty">还没抓过榜单。点右上「抓取并比对」，平台状态会出现在这里。</span>
      </div>

      <div v-if="r" class="hot-stats">
        <div class="hot-stat"><b>{{ r.matches.length }}</b><span>可蹭</span></div>
        <div class="hot-stat"><b>{{ r.total || 0 }}</b><span>比对条数</span></div>
        <div class="hot-stat"><b>{{ r.screened || 0 }}</b><span>已挡掉</span></div>
        <div class="hot-stat soft"><b>{{ strongN }}</b><span>强关联</span></div>
      </div>

      <div class="matches-wrap" id="hotMatches">
        <div v-if="!persona" class="hot-note"><Icon name="user" :size="18" />先在左边选一个账号，热点才有比对的对象。</div>
        <div v-else-if="h.running" class="matches"><div v-for="i in 3" :key="i" class="idea-skeleton tall"></div></div>
        <div v-else-if="h.runError" class="hot-note bad">{{ h.runError }}</div>
        <template v-else-if="r">
          <div class="matches-title">匹配结果<em>（共 {{ r.matches.length }} 条）</em>
            <span class="hint">{{ when(r.at) }} 比对了 {{ r.total }} 条热点<template v-if="r.screened">　·　已挡掉 {{ r.screened }} 条不适合蹭的<span class="screened-peek" :title="screenedTip">（看类型）</span></template></span>
          </div>
          <div v-if="!r.matches.length" class="hot-note">{{ r.note || '这一轮榜单里没有适合这个号蹭的热点。硬蹭不如不蹭，等下一轮。' }}</div>
          <div class="matches">
            <article v-for="(m, idx) in r.matches" :key="idx" class="match" :class="{ strong: m.strength === '强' }">
              <div class="match-top">
                <span class="match-no">{{ idx + 1 }}</span>
                <span class="hot-plat-chip" :data-plat="platKey(m.origin?.platform)">{{ shortPlat(m.origin?.platform) }}</span>
                <span class="grow"></span>
                <span class="badge" :class="`s-${m.strength}`">关联{{ m.strength }}</span>
                <span v-if="m.origin?.heat" class="heat-tag"><Icon name="flame" :size="12" />{{ heat(m.origin.heat) }}</span>
              </div>
              <h4 class="match-title">
                <a v-if="m.origin?.url" :href="m.origin.url" target="_blank" rel="noopener noreferrer">{{ m.origin.title }}<Icon name="link" :size="12" /></a>
                <template v-else>{{ m.origin?.title }}</template>
              </h4>
              <div v-if="m.origin?.summary" class="origin-box">
                <b>原文概要</b>
                <p>{{ m.origin.summary }}<em>{{ SUMMARY_SOURCE[m.origin.summarySource] || '' }}</em></p>
              </div>
              <div v-else class="origin-box muted">抓不到原文概要（平台反爬或需要 JS），动笔前请点开原文核实</div>
              <div class="match-block"><b>蹭点</b><p>{{ m.angle }}</p></div>
              <div class="match-block"><b>选题建议</b><p>{{ m.subject }}</p></div>
              <div v-if="m.caution" class="match-block caution"><b>注意分寸</b><p>{{ m.caution }}</p></div>
              <button class="btn primary block" :data-match="idx" @click="useMatch(m)"><Icon name="pen" :size="14" />用这个题材去创作</button>
            </article>
          </div>
        </template>
        <div v-else class="hot-empty">
          <Icon name="flame" :size="28" />
          <b>还没比对过</b>
          <span>点右上「抓取并比对」，或在下面手动粘一份榜单。适合这个号的会出现在这里。</span>
        </div>
      </div>
    </section>

    <section class="card board-card">
      <div class="card-head">
        <h2><Icon name="chart" :size="20" />抓到的原始榜单</h2>
        <span class="grow"></span>
        <span class="counter">{{ boardsAt }}</span>
        <button class="btn ghost small" id="boardRefresh" @click="h.loadBoards(true)"><Icon name="refresh" :size="14" />重新抓取</button>
      </div>
      <div class="board-filter">
        <button type="button" :class="{ on: !pick }" @click="pick = ''">全部<i>{{ h.boards?.items.length || 0 }}</i></button>
        <button v-for="g in groups" :key="g" type="button" :class="{ on: pick === g }" @click="pick = g">
          <span class="hot-plat-dot" :data-plat="platKey(g)" aria-hidden="true"></span>{{ g }}
        </button>
        <select id="boardFilter" v-model="pick" aria-label="平台筛选">
          <option value="">全部平台（{{ h.boards?.items.length || 0 }} 条）</option>
          <option v-for="g in groups" :key="g" :value="g">{{ g }}</option>
        </select>
      </div>
      <div class="board" id="boardList">
        <div v-if="h.boardsLoading" class="ideas-state">正在抓取榜单…</div>
        <div v-else-if="h.boardsError" class="ideas-state error">{{ h.boardsError }}</div>
        <template v-else>
          <div v-if="rows.length" class="board-row head">
            <span class="no">序号</span><span class="plat">平台</span><span class="ttl">标题</span><span class="lnk">原文</span><span class="heat">热度</span>
          </div>
          <div v-for="(it, i) in rows" :key="i" class="board-row">
            <span class="no">{{ i + 1 }}</span>
            <span class="plat"><span class="hot-plat-chip sm" :data-plat="platKey(it.platform)">{{ shortPlat(it.platform) }}</span></span>
            <a v-if="it.url" class="ttl" :href="it.url" target="_blank" rel="noopener noreferrer">{{ it.title }}</a>
            <span v-else class="ttl">{{ it.title }}</span>
            <span class="lnk">
              <a v-if="it.url" :href="it.url" target="_blank" rel="noopener noreferrer" title="打开原文">链接</a>
              <template v-else>—</template>
            </span>
            <span class="heat">{{ heat(it.heat) || '—' }}</span>
          </div>
          <div v-if="!rows.length" class="ideas-state">还没有榜单数据</div>
        </template>
      </div>

      <div class="manual" id="manualBox">
        <div class="manual-head">
          <b><Icon name="doc" :size="15" />榜单抓不到？手动粘一份</b>
          <span class="hint">一行一条，可从任何热榜页复制；前面的序号会自动去掉。最多约 5000 字。</span>
        </div>
        <div class="manual-row">
          <textarea id="manualInput" rows="5" maxlength="5000" v-model="manual"
            placeholder="1. 某某热点&#10;2. 另一个热点&#10;3. ..."></textarea>
          <div class="manual-side">
            <span class="counter">{{ manual.length }} / 5000</span>
            <BusyBtn class="btn primary" id="manualRun" :busy="h.running === 'manual'" :disabled="!persona || Boolean(h.running)"
              @click="runManual">用这份榜单比对</BusyBtn>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue';
import BusyBtn from './common/BusyBtn.vue';
import Icon from './common/Icon.vue';
import { useHotStore } from '../stores/hot.js';
import { useStudioStore } from '../stores/studio.js';
import { toast } from '../lib/feedback.js';
import { useBriefStore } from '../stores/brief.js';

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
  ? `榜单更新于 ${new Date(h.boards.at).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}` : ''));
const screenedTip = computed(() => (r.value?.screenedSample || []).map((b) => `${b.risk}：${b.title}`).join('\n'));
const strongN = computed(() => (r.value?.matches || []).filter((m) => m.strength === '强').length);

const heat = (n) => {
  if (!n) return '';
  if (n >= 100000000) return `${(n / 100000000).toFixed(1)} 亿`;
  if (n >= 10000) return `${(n / 10000).toFixed(1)} 万`;
  return String(n);
};
const when = (at) => new Date(at).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const tone = (name = '') => [...name].reduce((n, ch) => n + ch.charCodeAt(0), 0) % 5;

/* 平台色标：按榜单来源名 / 账号平台 key 归一类 */
function platKey(label = '') {
  const t = String(label).toLowerCase();
  if (/抖音|douyin/.test(t)) return 'douyin';
  if (/小红书|xhs|xiaohongshu|red/.test(t)) return 'xhs';
  if (/微博|weibo/.test(t)) return 'weibo';
  if (/b站|哔哩|bili/.test(t)) return 'bili';
  if (/百度|baidu/.test(t)) return 'baidu';
  if (/头条|toutiao/.test(t)) return 'toutiao';
  if (/36氪|36kr|kr36/.test(t)) return 'kr';
  if (/公众号|微信|wechat|gongzhonghao/.test(t)) return 'wx';
  if (/手动/.test(t)) return 'manual';
  return 'other';
}
function platMark(label = '') {
  const k = platKey(label);
  return ({ douyin: '抖', xhs: '红', weibo: '微', bili: 'B', baidu: '百', toutiao: '头', kr: '氪', wx: '公', manual: '粘', other: '热' })[k];
}
function shortPlat(label = '') {
  const s0 = String(label || '');
  return s0.replace(/热搜|热榜/g, '') || s0;
}

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
  const brief = useBriefStore();
  brief.reset();
  brief.useSubject(m.subject, {
    title: m.origin?.title || '', url: m.origin?.url || '',
    platform: m.origin?.platform || '', summary: m.origin?.summary || '',
    summarySource: m.origin?.summarySource || 'none', angle: m.angle,
  });
  toast('已带回创作简报，成稿会引用这条热点');
}
</script>
