<template>
    <aside class="sidebar">
      <div class="persona-bar">
        <div class="sidebar-head">
          <span>账号设定</span>
          <button class="btn ghost small" id="newPersonaBtn">＋ 新账号</button>
        </div>
        <!-- 默认只露头像 + 名称 + 定位；其余（目标用户、人设、语气档案…）折起来。
             侧栏是长期占屏的东西，平时不需要把整份设定摊在那儿。 -->
        <!-- 多账号时直接列出来，一行一个，不用下拉——下拉要先点开才知道有什么。
             当前账号那行展开成卡片（定位 + 齿轮 + 完整设定），其余是单行。 -->
        <!-- 账号列表还归 public/js/account.js 管（按 id 改 DOM），这里只放容器 -->
        <div class="persona-card">
          <div class="persona-list" id="personaList"></div>
          <button class="persona-more hidden" id="personaMoreBtn" type="button" aria-expanded="false">
            展开完整设定 <i>▾</i>
          </button>
          <div class="persona-summary hidden" id="personaSummary"></div>
        </div>
      </div>

      <div class="sidebar-head">
        <span>创作记录</span>
        <button class="btn ghost small" id="newBtn">＋ 新建</button>
      </div>

      <!-- 以下归 Vue 管：compose.js 只改 store（list、counts、historyMode、showArchived…），不碰这些节点。
           点击仍由 compose.js 在 #history / #historyFilter 上用事件委托处理，所以 data-* 属性要保留。 -->
      <div class="history-filter" id="historyFilter">
        <button data-arch="0" :class="{ on: s.historyMode === 'drafts' && !s.showArchived }">进行中<span class="n">{{ s.counts.active || '' }}</span></button>
        <button data-arch="1" :class="{ on: s.historyMode === 'drafts' && s.showArchived }">已归档<span class="n">{{ s.counts.archived || '' }}</span></button>
        <button data-view="speaks" :class="{ on: s.historyMode === 'speaks' }">口播<span class="n">{{ s.speakCount || '' }}</span></button>
      </div>

      <div class="history" id="history" v-show="s.historyMode !== 'speaks'">
        <div v-if="!s.list.length" class="empty">
          <template v-if="s.showArchived">归档里还是空的<br />在「进行中」把不再需要的收起来</template>
          <template v-else>{{ emptyTitle }}<br />从右边填写题材开始</template>
        </div>
        <div v-for="d in s.list" :key="d.id" class="history-item"
             :class="{ active: s.draft?.id === d.id, archived: d.archived_at }" :data-id="d.id">
          <div class="acts">
            <button :data-arch-id="d.id" :data-to="d.archived_at ? '0' : '1'"
              :title="d.archived_at ? '恢复到进行中' : '归档'">{{ d.archived_at ? '↩' : '📥' }}</button>
            <button class="del" :data-del="d.id" title="删除">×</button>
          </div>
          <h4>{{ d.title || d.subject }}</h4>
          <p><span v-if="s.personaId === null" class="persona-tag">{{ ownerName(d) }}</span><span>{{ platformLabel(d.platform) }}</span><span>·</span><span>{{ STATUS[d.status] || d.status }}</span></p>
        </div>
      </div>

      <!-- 口播记录还归 public/js/speak.js 管（拼 HTML、点开时往里插总评），和上面的列表分开放 -->
      <div class="history" id="speakHistory" v-show="s.historyMode === 'speaks'"></div>

      <div class="history-foot" id="historyFoot" :class="{ hidden: s.historyMode === 'speaks' || s.showArchived || !s.counts.activeDone }">
        <button class="btn ghost small" id="archiveDoneBtn" :disabled="s.archivingDone">
          <template v-if="s.archivingDone"><span class="spinner"></span> 处理中</template>
          <template v-else>把 {{ s.counts.activeDone }} 篇已完成的收起来</template>
        </button>
      </div>
    </aside>
</template>

<script setup>
import { computed } from 'vue';
import { useStudioStore } from '../stores/studio.js';

const s = useStudioStore();

const STATUS = { topics: '待选方向', writing: '生成中', done: '已完成' };

const platformLabel = (key) => s.meta?.platforms?.find((p) => p.key === key)?.label || key;

const ownerName = (d) => s.personas.find((p) => p.id === d.persona_id)?.name || '无账号';

const emptyTitle = computed(() => {
  const p = s.personas.find((x) => x.id === s.personaId);
  return p ? `「${p.name}」还没有创作记录` : '还没有创作记录';
});
</script>
