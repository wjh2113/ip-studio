<template>
  <div id="libraryView" class="library-view" :class="{ hidden: s.view !== 'library' }">
    <section class="card library-card">
      <div class="library-head">
        <div>
          <h2><Icon name="inbox" />素材与选题</h2>
          <p class="hint">素材挂在账号下，写作时按题材自动召回；选题池攒着想写还没写的。热点请走顶栏「热点」。</p>
        </div>
        <div class="library-tabs" role="tablist">
          <button type="button" role="tab" :aria-selected="lib.tab === 'materials'" :class="{ on: lib.tab === 'materials' }"
            @click="lib.tab = 'materials'">素材库<span class="n">{{ lib.list.length || '' }}</span></button>
          <button type="button" role="tab" :aria-selected="lib.tab === 'pool'" :class="{ on: lib.tab === 'pool' }"
            @click="lib.tab = 'pool'">选题池<span class="n">{{ openPool || '' }}</span></button>
        </div>
      </div>

      <!-- —— 素材 —— -->
      <template v-if="lib.tab === 'materials'">
        <div class="library-toolbar">
          <div class="library-kinds">
            <button type="button" class="chip-btn" :class="{ on: !lib.kind }" @click="lib.kind = ''">全部 {{ counts[''] || 0 }}</button>
            <button v-for="k in lib.kinds" :key="k" type="button" class="chip-btn" :class="{ on: lib.kind === k }"
              @click="lib.kind = k">{{ k }} {{ counts[k] || 0 }}</button>
          </div>
          <div class="library-actions">
            <label class="search">
              <Icon name="search" :size="14" />
              <input v-model="lib.q" type="search" placeholder="搜标题、正文、标签" maxlength="80" />
            </label>
            <button type="button" class="btn primary small" id="libNewBtn" @click="lib.startCreate()">
              <Icon name="plus" :size="14" />新建素材
            </button>
          </div>
        </div>

        <p v-if="!s.personas.length" class="hot-note">
          还没有账号。素材必须挂在账号下——先在左侧「＋ 新账号」，或去<a href="#" @click.prevent="goWrite">创作</a>里快速建号。
        </p>
        <p v-else-if="lib.error" class="hot-note bad">{{ lib.error }}</p>
        <p v-else-if="lib.loading" class="hint">加载中…</p>
        <div v-else-if="!rows.length" class="pool-empty">
          <Icon name="inbox" :size="28" />
          <b>{{ lib.list.length ? '没有符合筛选的素材' : '还没有素材' }}</b>
          <span>把真实经历、数据、案例存进来；写作时会按题材召回，模型不能编造之外的事。</span>
          <button v-if="s.personas.length" type="button" class="btn primary small" @click="lib.startCreate()">＋ 新建素材</button>
        </div>

        <div v-else class="library-body">
          <div class="library-table">
            <div class="library-th"><span>类型</span><span>标题 / 摘要</span><span>标签</span><span>用过</span><span>操作</span></div>
            <div v-for="m in rows" :key="m.id" class="library-row" :class="{ on: lib.selectedId === m.id }"
              @click="lib.selectedId = m.id">
              <span class="mat-kind">{{ m.kind }}</span>
              <div class="library-main">
                <b>{{ m.title }}</b>
                <p>{{ clip(m.body) }}</p>
                <em v-if="personaName(m.persona_id)" class="persona-tag">{{ personaName(m.persona_id) }}</em>
              </div>
              <div class="mat-tags">
                <span v-for="(t, i) in tagList(m.tags)" :key="i">{{ t }}</span>
              </div>
              <span class="mat-used">{{ m.used_count || 0 }}</span>
              <span class="library-acts" @click.stop>
                <button type="button" class="mini" title="编辑" @click="lib.startEdit(m)"><Icon name="pen" :size="14" /></button>
                <button type="button" class="mini rm" title="删除" @click="lib.remove(m)"><Icon name="trash" :size="14" /></button>
              </span>
            </div>
          </div>

          <aside v-if="detail" class="library-detail">
            <div class="library-detail-head">
              <span class="mat-kind">{{ detail.kind }}</span>
              <h3>{{ detail.title }}</h3>
              <button type="button" class="icon-btn" title="关闭" @click="lib.selectedId = null"><Icon name="x" /></button>
            </div>
            <p class="library-detail-body">{{ detail.body }}</p>
            <div v-if="tagList(detail.tags).length" class="mat-tags">
              <span v-for="(t, i) in tagList(detail.tags)" :key="i">{{ t }}</span>
            </div>
            <p class="hint">所属账号：{{ personaName(detail.persona_id) || '未绑定' }} · 用过 {{ detail.used_count || 0 }} 次</p>
            <div class="library-detail-foot">
              <button type="button" class="btn ghost small" @click="lib.startEdit(detail)">编辑</button>
              <button type="button" class="btn danger ghost small" @click="lib.remove(detail)">删除</button>
            </div>
          </aside>
        </div>
      </template>

      <!-- —— 选题池 —— -->
      <template v-else>
        <p class="hint" style="margin-bottom:12px">热点里看到的、推荐里想留的，先存这里；排期可空。完整蹭热点流程请用顶栏「热点」。</p>
        <div class="pool-add library-pool-add">
          <input v-model="lib.poolForm.subject" maxlength="200" placeholder="题材：想到什么先记一条" @keydown.enter.prevent="lib.addPool()" />
          <input v-model="lib.poolForm.plan_date" type="date" title="排到哪天" />
          <button type="button" class="btn primary small" @click="lib.addPool()">存入</button>
          <button type="button" class="btn ghost small" @click="s.view = 'hot'">去热点 →</button>
        </div>
        <div v-if="!lib.pool.length" class="pool-empty">
          <Icon name="bulb" :size="28" />
          <b>选题池还是空的</b>
          <span>在「热点」比对后点「用这个题材」，或在创作简报里把推荐题材存进来。</span>
          <button type="button" class="btn primary small" @click="s.view = 'hot'">打开热点</button>
        </div>
        <div v-else class="library-table pool-manage">
          <div class="library-th"><span>来源</span><span>题材</span><span>排期</span><span>状态</span><span>操作</span></div>
          <div v-for="x in lib.pool" :key="x.id" class="library-row" :class="{ done: x.status === 'done' }">
            <span class="src">{{ x.source }}</span>
            <div class="library-main">
              <b>{{ x.subject }}</b>
              <p v-if="x.note">{{ x.note }}</p>
              <em v-if="personaName(x.persona_id)" class="persona-tag">{{ personaName(x.persona_id) }}</em>
            </div>
            <input type="date" :value="x.plan_date" @change="lib.datePool(x.id, $event.target.value)" />
            <span class="hint">{{ statusLabel(x.status) }}</span>
            <span class="library-acts">
              <button type="button" class="mini" :disabled="x.status === 'done'" @click="lib.writePool(x)">写这条</button>
              <button type="button" class="mini rm" @click="lib.removePool(x)"><Icon name="trash" :size="14" /></button>
            </span>
          </div>
        </div>
      </template>
    </section>

    <!-- 新建 / 编辑素材 -->
    <div v-if="lib.form.open" class="modal-mask" @click.self="lib.cancelForm()">
      <div class="modal">
        <div class="modal-head">
          <h2>{{ lib.form.id ? '编辑素材' : '新建素材' }}</h2>
          <button type="button" class="icon-btn" @click="lib.cancelForm()"><Icon name="x" /></button>
        </div>
        <div class="modal-body library-form">
          <label v-if="!lib.form.id">挂到账号
            <select v-model.number="lib.form.personaId">
              <option v-for="p in s.personas" :key="p.id" :value="p.id">{{ p.name }}</option>
            </select>
          </label>
          <label>类型
            <select v-model="lib.form.kind">
              <option v-for="k in lib.kinds" :key="k" :value="k">{{ k }}</option>
            </select>
          </label>
          <label class="full">标题
            <input v-model="lib.form.title" maxlength="80" placeholder="一句话说清这条是什么" />
          </label>
          <label class="full">内容
            <textarea v-model="lib.form.body" rows="6" maxlength="4000"
              placeholder="具体细节：时间、数字、当时怎么想的、结果如何"></textarea>
          </label>
          <label class="full">标签
            <input v-model="lib.form.tags" maxlength="200" placeholder="逗号分隔，召回时权重更高" />
          </label>
          <p v-if="lib.error" class="form-error">{{ lib.error }}</p>
        </div>
        <div class="modal-foot">
          <button type="button" class="btn ghost" @click="lib.cancelForm()">取消</button>
          <BusyBtn class="btn primary" :busy="saving.busy.value" @click="save">保存</BusyBtn>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, watch } from 'vue';
import Icon from './common/Icon.vue';
import BusyBtn from './common/BusyBtn.vue';
import { useStudioStore } from '../stores/studio.js';
import { useLibraryStore } from '../stores/library.js';
import { useBusy } from '../lib/busy.js';

const s = useStudioStore();
const lib = useLibraryStore();
const saving = useBusy();

const rows = computed(() => lib.filtered());
const detail = computed(() => lib.selected());
const counts = computed(() => lib.countsByKind());
const openPool = computed(() => lib.pool.filter((x) => x.status !== 'done').length);

watch(() => [s.view, s.personaId], ([view]) => {
  if (view === 'library') lib.open();
});

function tagList(tags) {
  return String(tags || '').split(/[,，]/).map((t) => t.trim()).filter(Boolean);
}
function clip(s) {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return t.length > 80 ? `${t.slice(0, 80)}…` : t;
}
function personaName(id) {
  if (id == null) return '';
  return s.personas.find((p) => p.id === id)?.name || '';
}
function statusLabel(st) {
  return ({ idea: '待选', planned: '已排期', done: '已写成' })[st] || st;
}
function goWrite() {
  s.view = 'write';
}
async function save() {
  await saving.run(() => lib.saveForm());
}
</script>
