<template>
    <aside class="sidebar">
      <div class="persona-bar">
        <div class="sidebar-head">
          <span>账号设定</span>
          <button class="btn ghost small" id="newPersonaBtn" @click="account.open(null)">＋ 新账号</button>
        </div>
        <!-- 多账号时直接列出来，一行一个，不用下拉——下拉要先点开才知道有什么。
             当前账号那行展开成卡片（定位 + 齿轮），完整设定默认折起来：侧栏长期占屏，平时用不着把整份设定摊在那儿。 -->
        <div class="persona-card">
          <div class="persona-list" id="personaList">
            <button v-for="x in s.personas" :key="x.id" type="button" class="persona-row" :class="{ on: x.id === s.personaId }"
              :data-persona="x.id" @click="account.select(x.id)">
              <span class="persona-avatar">{{ x.name?.[0] || '·' }}</span>
              <span class="persona-name">
                <b>{{ x.name }}</b>
                <span class="persona-focus"><span class="pf-tag">{{ s.platformLabel(x.platform) }}</span>{{ x.id === s.personaId ? x.content_focus || '' : '' }}</span>
              </span>
              <span v-if="x.id === s.personaId" class="persona-gear" data-edit="1" title="编辑账号设定" @click.stop="account.open(x)">⚙</span>
            </button>
            <button type="button" class="persona-row" :class="{ on: !s.personaId }" data-persona="" @click="account.select(null)">
              <span class="persona-avatar">全</span>
              <span class="persona-name"><b>全部创作</b>
                <span class="persona-focus">{{ s.personas.length ? '不限账号，新建时不带账号语境' : '还没有账号设定' }}</span>
              </span>
            </button>
          </div>
          <button v-if="current" class="persona-more" id="personaMoreBtn" type="button" :aria-expanded="String(account.summaryOpen)"
            @click="account.summaryOpen = !account.summaryOpen">{{ account.summaryOpen ? '收起完整设定' : '展开完整设定' }} <i>▾</i></button>
          <div v-if="current && account.summaryOpen" class="persona-summary" id="personaSummary">
            <div v-for="[k, v] in summary" :key="k" class="persona-field" :class="{ digest: k.startsWith('语气') }"><b>{{ k }}</b>{{ v }}</div>
          </div>
        </div>
      </div>

      <div class="sidebar-head">
        <span>创作记录</span>
        <button class="btn ghost small" id="newBtn" @click="newDraft">＋ 新建</button>
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
             :class="{ active: s.draft?.id === d.id, archived: d.archived_at }" :data-id="d.id" @click="h.open(d.id)">
          <div class="acts">
            <button :data-arch-id="d.id" :data-to="d.archived_at ? '0' : '1'" :title="d.archived_at ? '恢复到进行中' : '归档'"
              @click.stop="h.archive(d.id, !d.archived_at)">{{ d.archived_at ? '↩' : '📥' }}</button>
            <button class="del" :data-del="d.id" title="删除" @click.stop="h.remove(d.id)">×</button>
          </div>
          <h4>{{ d.title || d.subject }}</h4>
          <p><span v-if="s.personaId === null" class="persona-tag">{{ ownerName(d) }}</span><span>{{ s.platformLabel(d.platform) }}</span><span>·</span><span>{{ DRAFT_STATUS[d.status] || d.status }}</span></p>
        </div>
      </div>

      <!-- 口播记录还归 public/js/speak.js 管（拼 HTML、点开时往里插总评），和上面的列表分开放 -->
      <div class="history" id="speakHistory" v-show="s.historyMode === 'speaks'"></div>

      <div class="history-foot" id="historyFoot" :class="{ hidden: s.historyMode === 'speaks' || s.showArchived || !h.counts.activeDone }">
        <BusyBtn class="btn ghost small" id="archiveDoneBtn" :busy="h.archivingDone" @click="h.archiveDone()">把 {{ h.counts.activeDone }} 篇已完成的收起来</BusyBtn>
      </div>
    </aside>
</template>

<script setup>
import { computed } from 'vue';
import BusyBtn from './common/BusyBtn.vue';
import { useStudioStore } from '../stores/studio.js';
import { creatorLine, useAccountStore } from '../stores/account.js';
import { DRAFT_STATUS, useHistoryStore } from '../stores/history.js';
import { useBriefStore } from '../stores/brief.js';
import { useFrameworksStore } from '../stores/frameworks.js';

const s = useStudioStore();
const account = useAccountStore();
const h = useHistoryStore();
const brief = useBriefStore();

const current = computed(() => s.currentPersona);

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

const ownerName = (d) => s.personas.find((p) => p.id === d.persona_id)?.name || '无账号';

const emptyTitle = computed(() => (current.value ? `「${current.value.name}」还没有创作记录` : '还没有创作记录'));

function newDraft() {
  if (s.streaming) return;
  brief.reset();
  useFrameworksStore().choose(null);
  brief.focusSubject += 1;
}
</script>
