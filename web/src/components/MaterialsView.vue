<template>
  <div id="libraryView" class="library-view" :class="{ hidden: s.view !== 'library' }">
    <section class="card library-card">
      <div class="library-head">
        <div>
          <h2><Icon name="inbox" />素材库</h2>
          <p class="hint">文章、链接、对标等存在这里；写作时按题材召回。选题灵感进「选题池」，蹭热点走顶栏「热点」。</p>
        </div>
        <div class="library-tabs" role="tablist">
          <button type="button" role="tab" :aria-selected="lib.tab === 'materials'" :class="{ on: lib.tab === 'materials' }"
            id="libTabMaterials" @click="lib.tab = 'materials'">素材<span class="n">{{ lib.list.length || '' }}</span></button>
          <button type="button" role="tab" :aria-selected="lib.tab === 'pool'" :class="{ on: lib.tab === 'pool' }"
            id="libTabPool" @click="lib.tab = 'pool'">选题池<span class="n">{{ openPool || '' }}</span></button>
        </div>
      </div>

      <!-- —— 素材 —— -->
      <template v-if="lib.tab === 'materials'">
        <p v-if="lib.error" class="hot-note bad">{{ lib.error }}</p>

        <div class="library-layout">
          <!-- 左：分类 -->
          <aside class="library-kinds-nav" aria-label="素材分类">
            <div class="library-kinds-title">素材分类</div>
            <button type="button" class="kind-nav" :class="{ on: !lib.kind }" @click="lib.kind = ''">
              <span class="kind-ico" data-kind="all"><Icon name="layers" :size="15" /></span>
              <span class="grow">全部</span>
              <i>{{ counts[''] || 0 }}</i>
            </button>
            <button v-for="k in lib.kinds" :key="k" type="button" class="kind-nav" :class="{ on: lib.kind === k }"
              @click="lib.kind = k">
              <span class="kind-ico" :data-kind="k"><Icon :name="kindIcon(k)" :size="15" /></span>
              <span class="grow">{{ k }}</span>
              <i>{{ counts[k] || 0 }}</i>
            </button>
            <button type="button" class="kind-nav pool-link" @click="lib.tab = 'pool'">
              <span class="kind-ico" data-kind="pool"><Icon name="bulb" :size="15" /></span>
              <span class="grow">选题灵感</span>
              <i>{{ openPool || 0 }}</i>
            </button>
          </aside>

          <!-- 中：工具条 + 列表/卡片 -->
          <div class="library-center">
            <div class="library-toolbar">
              <label class="search wide">
                <Icon name="search" :size="14" />
                <input id="libSearch" v-model="lib.q" type="search" placeholder="搜索标题、正文或标签…" maxlength="80" />
              </label>
              <div class="library-view-toggle" role="group" aria-label="视图">
                <button type="button" :class="{ on: lib.viewMode === 'list' }" title="列表" @click="lib.viewMode = 'list'">
                  <Icon name="list" :size="14" />列表
                </button>
                <button type="button" :class="{ on: lib.viewMode === 'card' }" title="卡片" @click="lib.viewMode = 'card'">
                  <Icon name="layers" :size="14" />卡片
                </button>
              </div>
              <select id="libSort" v-model="lib.sort" aria-label="排序">
                <option value="used">按使用次数</option>
                <option value="recent">按最近更新</option>
              </select>
              <div class="library-actions">
                <button type="button" class="btn ghost small" id="libFolderBtn" @click="pickFolder">
                  <Icon name="archive" :size="14" />导入本地文件夹
                </button>
                <button type="button" class="btn ghost small" id="libUrlBtn" @click="lib.importFromUrl()">
                  <Icon name="link" :size="14" />从链接提取
                </button>
                <button type="button" class="btn ghost small" id="libClipboardBtn" @click="lib.importClipboard()">
                  <Icon name="copy" :size="14" />从剪贴板导入
                </button>
                <button type="button" class="btn primary small" id="libNewBtn" @click="lib.startCreate()">
                  <Icon name="plus" :size="14" />新建素材
                </button>
              </div>
            </div>
            <input ref="folderInput" id="libFolderInput" type="file" webkitdirectory multiple class="sr-only"
              @change="onFolderPicked" />

            <p v-if="lib.loading" class="hint">加载中…</p>
            <div v-else-if="!rows.length" class="pool-empty">
              <Icon name="inbox" :size="28" />
              <b>{{ lib.list.length ? '没有符合筛选的素材' : '还没有素材' }}</b>
              <span>可新建、贴链接提取，或导入本地文件夹目录；写作时会按题材召回。</span>
              <div class="library-empty-actions">
                <button type="button" class="btn primary small" @click="lib.startCreate()">＋ 新建素材</button>
                <button type="button" class="btn ghost small" @click="pickFolder">导入本地文件夹</button>
              </div>
            </div>

            <template v-else>
              <!-- 列表 -->
              <div v-if="lib.viewMode === 'list'" class="library-table rich" id="libList">
                <div class="library-th">
                  <span></span><span>类型</span><span>标题 / 摘要</span><span>标签</span><span>用过</span><span>更新</span><span>操作</span>
                </div>
                <div v-for="m in rows" :key="m.id" class="library-row" :class="{ on: lib.selectedId === m.id }"
                  :data-mat="m.id" @click="lib.selectedId = m.id">
                  <span class="mat-thumb" :data-kind="m.kind"><Icon :name="kindIcon(m.kind)" :size="16" /></span>
                  <span class="mat-kind" :data-kind="m.kind">{{ m.kind }}</span>
                  <div class="library-main">
                    <b>{{ m.title }}</b>
                    <p>{{ clip(m.body) }}</p>
                  </div>
                  <div class="mat-tags">
                    <span v-for="(t, i) in tagList(m.tags).slice(0, 4)" :key="i">{{ t }}</span>
                  </div>
                  <span class="mat-used">{{ m.used_count || 0 }}</span>
                  <span class="mat-when">{{ stamp(m.updated_at || m.created_at) }}</span>
                  <span class="library-acts" @click.stop>
                    <button type="button" class="mini" title="编辑" @click="lib.startEdit(m)"><Icon name="pen" :size="14" /></button>
                    <button type="button" class="mini rm" title="删除" @click="lib.remove(m)"><Icon name="trash" :size="14" /></button>
                  </span>
                </div>
              </div>

              <!-- 卡片 -->
              <div v-else class="library-cards" id="libCards">
                <article v-for="m in rows" :key="m.id" class="mat-card" :class="{ on: lib.selectedId === m.id }"
                  :data-mat="m.id" @click="lib.selectedId = m.id">
                  <div class="mat-card-top">
                    <span class="mat-kind" :data-kind="m.kind">{{ m.kind }}</span>
                    <span class="mat-used">用过 {{ m.used_count || 0 }}</span>
                  </div>
                  <h4>{{ m.title }}</h4>
                  <p>{{ clip(m.body, 120) }}</p>
                  <div class="mat-tags">
                    <span v-for="(t, i) in tagList(m.tags).slice(0, 5)" :key="i">{{ t }}</span>
                  </div>
                  <div class="mat-card-foot">
                    <span>{{ stamp(m.updated_at || m.created_at) }}</span>
                  </div>
                </article>
              </div>

              <div class="library-foot">
                <span>共 {{ rows.length }} 条素材<template v-if="lib.kind || lib.q">（筛选自 {{ lib.list.length }} 条）</template></span>
                <span class="hint">素材只作参考，不会编造</span>
              </div>
            </template>
          </div>

          <!-- 右：详情 -->
          <aside v-if="detail" class="library-detail rich" id="libDetail">
            <div class="library-detail-head">
              <div>
                <span class="mat-kind" :data-kind="detail.kind">{{ detail.kind }}</span>
                <h3>{{ detail.title }}</h3>
              </div>
              <button type="button" class="icon-btn" title="关闭" @click="lib.selectedId = null"><Icon name="x" /></button>
            </div>

            <div class="lib-detail-block">
              <div class="lib-detail-label">
                <b>正文</b>
                <button type="button" class="mini" title="复制" @click="copyBody(detail.body)"><Icon name="copy" :size="13" /></button>
                <button type="button" class="mini" title="编辑" @click="lib.startEdit(detail)"><Icon name="pen" :size="13" /></button>
              </div>
              <p class="library-detail-body">{{ detail.body }}</p>
            </div>

            <div v-if="tagList(detail.tags).length" class="lib-detail-block">
              <div class="lib-detail-label"><b>标签</b></div>
              <div class="mat-tags">
                <span v-for="(t, i) in tagList(detail.tags)" :key="i">{{ t }}</span>
              </div>
            </div>

            <div class="lib-detail-block">
              <div class="lib-detail-label"><b>使用</b></div>
              <p class="hint" style="margin:0">用过 {{ detail.used_count || 0 }} 次 · 更新于 {{ stamp(detail.updated_at || detail.created_at) }}</p>
            </div>

            <p class="lib-disclaimer">素材仅作参考，写作时召回真东西；模型不能编造之外的事。</p>
            <div class="library-detail-foot">
              <button type="button" class="btn primary small" @click="lib.startEdit(detail)">编辑</button>
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
          <label>类型
            <select v-model="lib.form.kind">
              <option v-for="k in lib.kinds" :key="k" :value="k">{{ k }}</option>
            </select>
          </label>
          <label class="full">标题
            <input v-model="lib.form.title" maxlength="80" placeholder="一句话说清这条是什么" />
          </label>
          <label class="full">内容
            <textarea v-model="lib.form.body" rows="8" maxlength="15000"
              placeholder="具体细节，或粘贴链接提取 / 导入文件夹后的目录"></textarea>
          </label>
          <label class="full">标签
            <input v-model="lib.form.tags" maxlength="200" placeholder="逗号分隔，召回时权重更高" />
          </label>
          <p v-if="lib.form.sourceUrl" class="hint">来源：{{ lib.form.sourceUrl }}</p>
          <p v-if="lib.error" class="form-error">{{ lib.error }}</p>
        </div>
        <div class="modal-foot">
          <button type="button" class="btn ghost" @click="lib.cancelForm()">取消</button>
          <BusyBtn class="btn primary" :busy="saving.busy.value" @click="save">{{ lib.form.id ? '保存' : '存进素材库' }}</BusyBtn>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue';
import Icon from './common/Icon.vue';
import BusyBtn from './common/BusyBtn.vue';
import { useStudioStore } from '../stores/studio.js';
import { useLibraryStore } from '../stores/library.js';
import { useBusy } from '../lib/busy.js';
import { stamp } from '../lib/text.js';
import { toast } from '../lib/feedback.js';

const s = useStudioStore();
const lib = useLibraryStore();
const saving = useBusy();
const folderInput = ref(null);

const rows = computed(() => lib.filtered());
const detail = computed(() => lib.selected());
const counts = computed(() => lib.countsByKind());
const openPool = computed(() => lib.pool.filter((x) => x.status !== 'done').length);

watch(() => s.view, (view) => {
  if (view === 'library') lib.open();
});

const KIND_ICON = {
  文章: 'doc', 图片: 'image', 视频: 'video', 链接: 'link',
  语音: 'mic', 框架参考: 'layers', 对标账号: 'users',
};
function kindIcon(k) { return KIND_ICON[k] || 'inbox'; }

function tagList(tags) {
  return String(tags || '').split(/[,，]/).map((t) => t.trim()).filter(Boolean);
}
function clip(s, n = 80) {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
}
function personaName(id) {
  if (id == null) return '';
  return s.personas.find((p) => p.id === id)?.name || '';
}
function statusLabel(st) {
  return ({ idea: '待选', planned: '已排期', done: '已写成' })[st] || st;
}
function pickFolder() {
  folderInput.value?.click();
}
async function onFolderPicked(ev) {
  const input = ev.target;
  try {
    await lib.importFolder(input.files);
  } finally {
    input.value = '';
  }
}
async function copyBody(text) {
  try {
    await navigator.clipboard.writeText(String(text || ''));
    toast('已复制正文');
  } catch {
    toast('复制失败');
  }
}
async function save() {
  await saving.run(() => lib.saveForm());
}
</script>
