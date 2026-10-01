<template>
  <div id="speakView" class="speak-view" :class="{ hidden: s.view !== 'speak' }">
    <section class="card speak-page-card">
      <div class="speak-page-head">
        <div>
          <h2><Icon name="mic" />口播</h2>
          <p class="hint">选一篇成稿去练，或回看历史录音 / 视频与打分。提词器、分段提示仍在创作页的口播区。</p>
        </div>
        <div class="library-tabs" role="tablist">
          <button type="button" role="tab" :aria-selected="sp.pageTab === 'practice'" :class="{ on: sp.pageTab === 'practice' }"
            id="speakTabPractice" @click="sp.pageTab = 'practice'">去练<span class="n">{{ practiceCount || '' }}</span></button>
          <button type="button" role="tab" :aria-selected="sp.pageTab === 'records'" :class="{ on: sp.pageTab === 'records' }"
            id="speakTabRecords" @click="sp.pageTab = 'records'">评测记录<span class="n">{{ sp.history.length || '' }}</span></button>
        </div>
      </div>

      <!-- —— 去练 —— -->
      <template v-if="sp.pageTab === 'practice'">
        <p class="hint" style="margin-bottom:12px">有口播提示、还没练到 60 分的优先列在上面；已有提示的成稿也可以再练一遍。</p>
        <p v-if="sp.pageError" class="hot-note bad">{{ sp.pageError }}</p>
        <p v-else-if="sp.pageLoading" class="hint">加载中…</p>
        <div v-else-if="!practiceCount" class="pool-empty">
          <Icon name="mic" :size="28" />
          <b>暂时没有可练的稿子</b>
          <span>先在「创作」里写成稿，生成口播提示后再回来；或从侧栏打开一篇成稿进口播区。</span>
          <button type="button" class="btn primary small" @click="s.view = 'write'">去创作 →</button>
        </div>
        <template v-else>
          <h3 v-if="sp.todo.length" class="speak-sec-title">待练<span class="hint">有提示、还没合格录音</span></h3>
          <div v-if="sp.todo.length" class="speak-practice-list">
            <div v-for="x in sp.todo" :key="'t' + x.id" class="speak-practice-row">
              <div class="grow">
                <b>{{ x.title || '未命名' }}</b>
                <span class="hint">待练口播</span>
              </div>
              <button type="button" class="btn primary small" :data-speak-practice="x.id" @click="sp.practiceDraft(x.id)">
                <Icon name="mic" :size="14" />去口播
              </button>
            </div>
          </div>
          <h3 v-if="moreReady.length" class="speak-sec-title">可再练<span class="hint">已有口播提示的成稿</span></h3>
          <div v-if="moreReady.length" class="speak-practice-list">
            <div v-for="x in moreReady" :key="'r' + x.id" class="speak-practice-row">
              <div class="grow">
                <b>{{ x.title || '未命名' }}</b>
                <span class="hint">{{ s.platformLabel(x.platform) }}</span>
              </div>
              <button type="button" class="btn ghost small" :data-speak-practice="x.id" @click="sp.practiceDraft(x.id)">再练一遍</button>
            </div>
          </div>
        </template>
      </template>

      <!-- —— 评测记录 —— -->
      <template v-else>
        <div class="library-toolbar">
          <label class="search">
            <Icon name="search" :size="14" />
            <input id="speakSearch" v-model="sp.q" type="search" placeholder="搜标题" maxlength="80" />
          </label>
          <button type="button" class="btn ghost small" id="speakRefreshBtn" :disabled="sp.pageLoading" @click="sp.loadPage()">
            <Icon name="refresh" :size="14" />刷新
          </button>
        </div>
        <p v-if="sp.pageError" class="hot-note bad">{{ sp.pageError }}</p>
        <p v-else-if="sp.pageLoading && !sp.history.length" class="hint">加载中…</p>
        <div v-else-if="!rows.length" class="pool-empty">
          <Icon name="mic" :size="28" />
          <b>{{ sp.history.length ? '没有符合筛选的记录' : '还没有口播记录' }}</b>
          <span>生成口播提示后还要上传音视频；转写和总评在后台做，好了会出现在这里。提示本身仍在创作页那篇成稿里。</span>
          <button type="button" class="btn primary small" @click="sp.pageTab = 'practice'">去选一篇练 →</button>
        </div>
        <div v-else class="library-body speak-page-body">
          <div class="library-table" id="speakPageList">
            <div class="library-th speak-th"><span>分数</span><span>稿子 / 摘要</span><span>文件</span><span>时间</span><span>操作</span></div>
            <div v-for="x in rows" :key="x.id" class="library-row speak-page-row" :class="{ on: sp.detail?.id === x.id }"
              :data-speak-row="x.id" @click="sp.selectSpeak(x.id)">
              <span class="speak-score-cell" :class="tone(x)">{{ scoreLabel(x) }}</span>
              <div class="library-main">
                <b>{{ x.title || '未命名' }}</b>
                <p>{{ speakLine(x) }}</p>
                <em v-if="x.draftGone || x.stale" class="persona-tag">{{ x.draftGone ? '稿子已不在' : '当时的稿子' }}</em>
              </div>
              <span class="speak-file-tag">{{ fileKind(x) }}</span>
              <span class="speak-when">{{ stamp(x.createdAt) }}</span>
              <span class="library-acts" @click.stop>
                <button type="button" class="mini rm" title="删除" :data-speak-del="x.id" @click="sp.remove(x.id)">
                  <Icon name="trash" :size="14" />
                </button>
              </span>
            </div>
          </div>

          <aside v-if="sp.detail" class="library-detail speak-page-detail" id="speakPageDetail">
            <div class="library-detail-head">
              <span class="speak-score-cell" :class="tone(sp.detail)">{{ scoreLabel(sp.detail) }}</span>
              <h3>{{ sp.detail.title || '未命名' }}</h3>
              <button type="button" class="icon-btn" title="关闭" @click="sp.detail = null"><Icon name="x" /></button>
            </div>
            <p class="hint">{{ stamp(sp.detail.createdAt) }} · {{ fileKind(sp.detail) }}
              <template v-if="sp.detail.bytes"> · {{ sizeLabel(sp.detail.bytes) }}</template>
            </p>
            <SpeakReview :speak="sp.detail" />
            <div class="library-detail-foot">
              <button v-if="sp.detail.draftId && !sp.detail.draftGone" type="button" class="btn primary small"
                id="speakOpenDraftBtn" @click="sp.practiceDraft(sp.detail.draftId)">打开稿子口播区</button>
              <button type="button" class="btn danger ghost small" @click="sp.remove(sp.detail.id)">删除</button>
            </div>
          </aside>
        </div>
      </template>
    </section>
  </div>
</template>

<script setup>
import { computed, watch } from 'vue';
import Icon from './common/Icon.vue';
import SpeakReview from './SpeakReview.vue';
import { useStudioStore } from '../stores/studio.js';
import { audioOnly, speakLine, useSpeakStore } from '../stores/speak.js';
import { stamp } from '../lib/text.js';

const s = useStudioStore();
const sp = useSpeakStore();

const todoIds = computed(() => new Set(sp.todo.map((x) => x.id)));
const moreReady = computed(() => sp.readyCues.filter((x) => !todoIds.value.has(x.id)));
const practiceCount = computed(() => sp.todo.length + moreReady.value.length);

const rows = computed(() => {
  const needle = sp.q.trim().toLowerCase();
  if (!needle) return sp.history;
  return sp.history.filter((x) => (x.title || '').toLowerCase().includes(needle));
});

watch(() => [s.view, s.personaId], ([view]) => { if (view === 'speak') sp.loadPage(); });

const tone = (x) => (x.score == null ? '' : x.score >= 80 ? 'good' : x.score >= 60 ? 'mid' : 'low');
const scoreLabel = (x) => {
  if (x.status === 'running') return '…';
  if (x.status === 'failed') return '!';
  return x.score == null ? '—' : String(x.score);
};
const fileKind = (x) => {
  if (!x.audio && !x.mime && !x.file) return '无文件';
  return audioOnly(x) ? '音频' : '视频';
};
const sizeLabel = (n) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
</script>
