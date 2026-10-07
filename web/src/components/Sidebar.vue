<template>
    <aside class="sidebar">
      <!-- 素材库页（含新增 / 编辑）：上半截换成素材分类；选题池要挑账号在表单右侧的「目标」里 -->
      <MaterialKinds v-if="libMode" />
      <div v-else class="persona-bar">
        <div class="sidebar-head">
          <span class="sh-title">账号设定<Icon name="gear" :size="14" /></span>
          <span class="sh-acts">
            <button class="btn primary small" id="newPersonaBtn" @click="account.open(null)"><Icon name="plus" :size="14" />新账号</button>
            <button v-if="s.view === 'write'" type="button" class="rail-btn" id="sideFoldBtn" title="收起左栏，给正文腾地方" aria-label="收起左栏" @click="layout.toggleSide()"><Icon name="chev-left" :size="16" /></button>
          </span>
        </div>
        <!-- 多账号时直接列出来，一行一个，不用下拉——下拉要先点开才知道有什么。
             当前账号那行高亮（定位 + 齿轮），完整设定默认折起来：侧栏长期占屏，平时用不着把整份设定摊在那儿。 -->
        <div class="persona-card">
          <div class="persona-list" id="personaList">
            <button v-for="x in s.personas" :key="x.id" type="button" class="persona-row" :class="{ on: x.id === s.personaId }"
              :data-persona="x.id" @click="account.select(x.id)">
              <span class="persona-avatar" :data-tone="tone(x.name)">{{ x.name?.[0] || '·' }}</span>
              <span class="persona-name">
                <span class="pn-line"><b>{{ x.name }}</b><span class="pf-tag">{{ s.platformLabel(x.platform) }}</span></span>
                <span class="persona-focus">{{ x.content_focus || '还没写主要内容' }}</span>
              </span>
              <span v-if="x.id === s.personaId" class="persona-gear" data-edit="1" title="编辑账号设定" @click.stop="account.open(x)"><Icon name="gear" :size="15" /></span>
            </button>
            <button type="button" class="persona-row all" :class="{ on: !s.personaId }" data-persona="" @click="account.select(null)">
              <span class="persona-avatar"><Icon name="layers" :size="15" /></span>
              <span class="persona-name"><span class="pn-line"><b>全部创作</b></span>
                <span class="persona-focus">{{ s.personas.length ? '不限账号，新建时不带账号语境' : '还没有账号设定' }}</span>
              </span>
            </button>
          </div>
          <div v-if="current" class="persona-sum-box" :class="{ open: account.summaryOpen }">
            <button class="persona-more" id="personaMoreBtn" type="button" :aria-expanded="String(account.summaryOpen)"
              @click="account.summaryOpen = !account.summaryOpen"><Icon name="doc" :size="14" /><span>{{ account.summaryOpen ? '收起完整设定' : '展开完整设定' }}</span><Icon class="caret" name="chev-down" :size="14" /></button>
            <div v-if="account.summaryOpen" class="persona-summary" id="personaSummary">
              <div v-for="[k, v] in summary" :key="k" class="persona-field" :class="{ digest: k.startsWith('语气') }"><b>{{ k }}</b>{{ v }}</div>
              <button type="button" class="persona-edit-link" @click="account.open(current)">编辑完整设定<Icon name="chev-right" :size="13" /></button>
            </div>
          </div>
        </div>
      </div>

      <!-- 创作记录只在创作相关的页面出现；素材库的侧栏只放素材分类 -->
      <template v-if="!libMode">
      <div class="sidebar-head">
        <span class="sh-title">创作记录<Icon name="clock" :size="14" /></span>
        <button class="btn primary small" id="newBtn" @click="newDraft"><Icon name="plus" :size="14" />新建</button>
      </div>

      <div class="history-filter" id="historyFilter">
        <button data-arch="0" :class="{ on: s.historyMode === 'drafts' && !s.showArchived }" @click="h.filter('active')">进行中<span class="n">{{ h.counts.active || '' }}</span></button>
        <button data-arch="1" :class="{ on: s.historyMode === 'drafts' && s.showArchived }" @click="h.filter('archived')">已归档<span class="n">{{ h.counts.archived || '' }}</span></button>
        <button data-view="speaks" :class="{ on: s.historyMode === 'speaks' }" @click="h.filter('speaks')">口播<span class="n">{{ s.speakCount || '' }}</span></button>
      </div>

      <div class="history" id="history" v-show="s.historyMode !== 'speaks'">
        <div v-if="!h.list.length" class="empty">
          <template v-if="s.showArchived">归档里还是空的<br />在「进行中」把不再需要的收起来</template>
          <template v-else>{{ emptyTitle }}<br />从右边填写题材开始</template>
        </div>
        <div v-for="d in h.list" :key="d.id" class="history-item"
             :class="{ active: s.draft?.id === d.id, archived: d.archived_at }" :data-id="d.id" @click="openDraft(d.id)">
          <div class="acts">
            <button :data-arch-id="d.id" :data-to="d.archived_at ? '0' : '1'" :title="d.archived_at ? '恢复到进行中' : '归档'"
              @click.stop="h.archive(d.id, !d.archived_at)"><Icon :name="d.archived_at ? 'undo' : 'archive'" :size="14" /></button>
            <button class="del" :data-del="d.id" title="删除" @click.stop="h.remove(d.id)"><Icon name="trash" :size="14" /></button>
          </div>
          <h4>{{ d.title || d.subject }}</h4>
          <p><span v-if="s.personaId === null" class="persona-tag">{{ ownerName(d) }}</span><span class="plat">{{ s.platformLabel(d.platform) }}</span><span class="st" :data-st="d.status">{{ DRAFT_STATUS[d.status] || d.status }}</span></p>
        </div>
      </div>

      <!-- 口播记录：点开一遍跳到那篇的口播模式；稿子已经不在的，就地展开当时的总评 -->
      <div class="history" id="speakHistory" v-show="s.historyMode === 'speaks'">
        <div v-if="!sp.history.length" class="empty">还没有录音评测<br />「重新生成」只是口播提示，仍在这篇成稿里<br />上传音视频后才会出现在这里</div>
        <div v-for="x in sp.history" :key="x.id" class="history-item" :class="{ active: s.focusSpeakId === x.id }" :data-speak="x.id"
          @click="sp.openRecord(x.id)">
          <div class="acts">
            <button class="del" :data-speak-del="x.id" title="删除" @click.stop="sp.remove(x.id)"><Icon name="trash" :size="14" /></button>
          </div>
          <h4>{{ x.score == null ? '—' : `${x.score} 分` }}　{{ x.title || '未命名' }}</h4>
          <p><span>{{ stamp(x.createdAt) }}</span><span>·</span><span>{{ speakLine(x) }}</span></p>
          <div v-if="sp.orphan?.id === x.id" class="speak-orphan" @click.stop><SpeakReview :speak="sp.orphan" /></div>
        </div>
      </div>

      <div class="history-foot" id="historyFoot" :class="{ hidden: s.historyMode === 'speaks' || s.showArchived || !h.counts.activeDone }">
        <BusyBtn class="btn ghost small" id="archiveDoneBtn" :busy="h.archivingDone" @click="h.archiveDone()">把 {{ h.counts.activeDone }} 篇已完成的收起来</BusyBtn>
      </div>
      </template>
    </aside>
</template>

<script setup>
import { computed } from 'vue';
import BusyBtn from './common/BusyBtn.vue';
import Icon from './common/Icon.vue';
import { useStudioStore } from '../stores/studio.js';
import { creatorLine, useAccountStore } from '../stores/account.js';
import { DRAFT_STATUS, useHistoryStore } from '../stores/history.js';
import { useBriefStore } from '../stores/brief.js';
import { useFrameworksStore } from '../stores/frameworks.js';
import { speakLine, useSpeakStore } from '../stores/speak.js';
import SpeakReview from './SpeakReview.vue';
import MaterialKinds from './MaterialKinds.vue';
import { useLibraryStore } from '../stores/library.js';
import { useLayoutStore } from '../stores/layout.js';
import { stamp } from '../lib/text.js';

const s = useStudioStore();
const account = useAccountStore();
const h = useHistoryStore();
const brief = useBriefStore();
const sp = useSpeakStore();

const lib = useLibraryStore();
const layout = useLayoutStore();
const current = computed(() => s.currentPersona);
const libMode = computed(() => s.view === 'library');

const summary = computed(() => {
  const p = current.value;
  if (!p) return [];
  return [
    ['内容定位', p.content_focus], ['目标用户', p.audience],
    ['解决的问题', p.problem], ['备注', p.notes],
    ['个人人设', [creatorLine(p), p.creator_traits].filter(Boolean).join('\n')],
    [`语气档案（学了 ${p.sample_count || 0} 篇）`, p.style_digest],
  ].filter(([, v]) => v);
});

// 头像底色按名字固定取一档：同一个号每次看到都是同一个颜色，扫一眼就认得
const tone = (name = '') => [...name].reduce((n, ch) => n + ch.charCodeAt(0), 0) % 5;

const ownerName = (d) => s.personas.find((p) => p.id === d.persona_id)?.name || '无账号';

const emptyTitle = computed(() => (current.value ? `「${current.value.name}」还没有创作记录` : '还没有创作记录'));

function openDraft(id) {
  h.open(id);
}

function newDraft() {
  if (s.streaming) return;
  brief.reset();
  useFrameworksStore().choose(null);
  brief.focusSubject += 1;
}
</script>
