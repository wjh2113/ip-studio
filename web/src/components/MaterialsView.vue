<template>
  <div id="libraryView" class="library-view" :class="{ hidden: s.view !== 'library' }">
    <!-- 新增 / 编辑素材：整页表单 -->
    <MaterialForm v-if="lib.form.open" />

    <template v-else>
      <!-- 顶部工具条：搜索、视图、排序；右边是导入和新建 -->
      <div class="lib-toolbar">
        <label class="lib-search">
          <Icon name="search" :size="15" />
          <input id="libSearch" ref="searchInput" v-model="lib.q" type="search" maxlength="80"
            :placeholder="lib.tab === 'pool' ? '在选题池里搜…' : '搜索标题、正文、来源或标签…'" />
          <kbd>{{ isMac ? '⌘' : 'Ctrl' }} K</kbd>
        </label>
        <template v-if="lib.tab === 'materials'">
          <div class="lib-seg" role="group" aria-label="视图">
            <button type="button" :class="{ on: lib.viewMode === 'list' }" @click="lib.viewMode = 'list'"><Icon name="list" :size="14" />列表</button>
            <button type="button" :class="{ on: lib.viewMode === 'card' }" @click="lib.viewMode = 'card'"><Icon name="card" :size="14" />卡片</button>
          </div>
          <label class="lib-sort">
            <Icon name="list" :size="14" />
            <select id="libSort" v-model="lib.sort" aria-label="排序">
              <option value="used">按使用次数排序</option>
              <option value="recent">按最近更新排序</option>
            </select>
            <Icon name="chev-down" :size="14" />
          </label>
        </template>
        <div class="lib-toolbar-acts">
          <div class="lib-more" :class="{ open: moreOpen }">
            <button type="button" class="btn ghost small icon-only" id="libMoreBtn" title="更多导入方式"
              :aria-expanded="String(moreOpen)" @click.stop="moreOpen = !moreOpen"><Icon name="download" :size="15" /><Icon name="chev-down" :size="12" /></button>
            <div v-if="moreOpen" class="lib-pop" @click="moreOpen = false">
              <button type="button" id="libFolderBtn" @click="pickFolder"><Icon name="folder" :size="15" />导入本地文件夹</button>
              <button type="button" id="libUrlBtn" @click="lib.importFromUrl()"><Icon name="link" :size="15" />从链接提取</button>
            </div>
          </div>
          <button type="button" class="btn ghost small" id="libClipboardBtn" @click="lib.importClipboard()">
            <Icon name="clipboard" :size="15" />从剪贴板导入
          </button>
          <button type="button" class="btn primary small" id="libNewBtn" @click="lib.startCreate()">
            <Icon name="plus" :size="15" />新建素材
          </button>
        </div>
      </div>
      <input ref="folderInput" id="libFolderInput" type="file" webkitdirectory multiple class="sr-only" @change="onFolderPicked" />

      <!-- —— 素材 —— -->
      <div v-if="lib.tab === 'materials'" class="lib-body" :class="{ 'has-detail': !!detail }">
        <section class="lib-main">
          <p v-if="lib.error" class="hot-note bad">{{ lib.error }}</p>

          <!-- 种类快捷筛选 + 更多筛选（其余种类、内容标签） -->
          <div class="lib-filters">
            <div class="lib-chips" role="tablist" aria-label="按种类筛选">
              <button type="button" class="lib-chip" :class="{ on: !lib.kind }" @click="lib.kind = ''">全部</button>
              <button v-for="k in QUICK_KINDS" :key="k" type="button" class="lib-chip" :class="{ on: lib.kind === k }"
                @click="lib.kind = k">{{ k }}</button>
            </div>
            <div class="lib-more-filter" :class="{ open: filterOpen }">
              <button type="button" class="lib-chip more" id="libFilterBtn" :class="{ on: !!lib.tag || otherKindOn }"
                @click.stop="filterOpen = !filterOpen">
                <Icon name="filter" :size="13" />{{ filterLabel }}<Icon name="chev-down" :size="13" />
              </button>
              <div v-if="filterOpen" class="lib-pop wide" @click.stop>
                <div class="lib-pop-label">其他种类</div>
                <div class="lib-pop-chips">
                  <button v-for="k in otherKinds" :key="k" type="button" class="tag-chip" :class="{ on: lib.kind === k }"
                    @click="lib.kind = lib.kind === k ? '' : k">{{ k }}<i>{{ counts[k] || 0 }}</i></button>
                </div>
                <div class="lib-pop-label">内容标签</div>
                <div class="lib-pop-chips" id="libTagFilter">
                  <button v-for="t in lib.allTags()" :key="t" type="button" class="tag-chip"
                    :class="{ on: lib.tag === t, preset: lib.CONTENT_TAGS.includes(t) }"
                    @click="lib.tag = lib.tag === t ? '' : t">{{ t }}<i v-if="tagCounts[t]">{{ tagCounts[t] }}</i></button>
                </div>
                <div class="lib-pop-foot">
                  <button type="button" class="btn ghost small" @click="lib.tag = ''; lib.kind = ''">清除筛选</button>
                  <button type="button" class="btn primary small" @click="filterOpen = false">好</button>
                </div>
              </div>
            </div>
            <span v-if="lib.tag" class="lib-active-tag">标签：{{ lib.tag }}<button type="button" title="去掉" @click="lib.tag = ''"><Icon name="x" :size="12" /></button></span>
          </div>

          <p v-if="lib.loading && !lib.list.length" class="hint lib-loading">加载中…</p>
          <div v-else-if="!rows.length" class="pool-empty lib-empty">
            <Icon name="inbox" :size="28" />
            <b>{{ lib.list.length ? '没有符合筛选的素材' : '还没有素材' }}</b>
            <span>可新建、贴链接提取，或导入本地文件夹；用「经历 / 数据 / 案例」等标签标内容性质，写作时按题材召回。</span>
            <div class="library-empty-actions">
              <button type="button" class="btn primary small" @click="lib.startCreate()"><Icon name="plus" :size="14" />新建素材</button>
              <button type="button" class="btn ghost small" @click="pickFolder">导入本地文件夹</button>
            </div>
          </div>

          <template v-else>
            <!-- 列表 -->
            <div v-if="lib.viewMode === 'list'" class="lib-table" id="libList" role="table">
              <div class="lib-tr lib-th" role="row">
                <span><input type="checkbox" :checked="allChecked" :indeterminate.prop="someChecked" aria-label="全选本页" @change="toggleAll" /></span>
                <span>种类</span><span>标题</span><span>正文 / 来源摘要</span><span>标签</span>
                <span class="num">用过</span><span>更新时间</span><span class="end">操作</span>
              </div>
              <div v-for="m in pageRows" :key="m.id" class="lib-tr" role="row" :class="{ on: lib.selectedId === m.id }"
                :data-mat="m.id" @click="lib.selectedId = m.id">
                <span @click.stop><input v-model="lib.checked" type="checkbox" :value="m.id" :aria-label="`选中 ${m.title}`" /></span>
                <span class="kind-ico" :data-kind="m.kind" :title="m.kind"><Icon :name="kindIcon(m.kind)" :size="14" /></span>
                <div class="lib-title">
                  <span class="lib-thumb" :data-kind="m.kind">
                    <img v-if="materialImage(m)" :src="materialImage(m)" alt="" loading="lazy" />
                    <Icon v-else :name="kindIcon(m.kind)" :size="18" />
                  </span>
                  <b>
                    <a v-if="materialUrl(m)" class="mat-title-link" :href="materialUrl(m)" target="_blank"
                      rel="noopener noreferrer" title="打开原文" @click.stop>{{ m.title }}</a>
                    <template v-else>{{ m.title }}</template>
                  </b>
                </div>
                <p class="lib-snippet">{{ materialText(m) || '—' }}</p>
                <div class="lib-tags">
                  <span v-for="(t, i) in tagList(m.tags).slice(0, 3)" :key="i" :class="{ first: i === 0 }">{{ t }}</span>
                </div>
                <span class="num">{{ m.used_count || 0 }}</span>
                <span class="lib-when">{{ stamp(m.updated_at || m.created_at) }}</span>
                <span class="lib-acts" @click.stop>
                  <button v-if="lib.isLocalFolder(m)" type="button" class="lib-act" title="重新读取本地文件夹"
                    :data-refresh-folder="m.id" @click="pickFolderRefresh(m)"><Icon name="refresh" :size="15" /></button>
                  <button type="button" class="lib-act" title="编辑" @click="lib.startEdit(m)"><Icon name="pen" :size="15" /></button>
                  <button type="button" class="lib-act" title="这是我自己的经历或数据：挪到个人档案" :data-to-profile="m.id" @click="lib.toProfile(m)"><Icon name="user" :size="15" /></button>
                  <button type="button" class="lib-act rm" title="删除" @click="lib.remove(m)"><Icon name="trash" :size="15" /></button>
                </span>
              </div>
            </div>

            <!-- 卡片 -->
            <div v-else class="lib-cards" id="libCards">
              <article v-for="m in pageRows" :key="m.id" class="lib-card" :class="{ on: lib.selectedId === m.id }"
                :data-mat="m.id" @click="lib.selectedId = m.id">
                <div class="lib-card-cover" :data-kind="m.kind">
                  <img v-if="materialImage(m)" :src="materialImage(m)" alt="" loading="lazy" />
                  <Icon v-else :name="kindIcon(m.kind)" :size="26" />
                  <span class="mat-kind" :data-kind="m.kind">{{ m.kind }}</span>
                  <input v-model="lib.checked" type="checkbox" :value="m.id" :aria-label="`选中 ${m.title}`" @click.stop />
                </div>
                <h4>{{ m.title }}</h4>
                <p>{{ materialText(m) }}</p>
                <div class="lib-tags">
                  <span v-for="(t, i) in tagList(m.tags).slice(0, 4)" :key="i" :class="{ first: i === 0 }">{{ t }}</span>
                </div>
                <div class="lib-card-foot">
                  <span>用过 {{ m.used_count || 0 }} · {{ stamp(m.updated_at || m.created_at) }}</span>
                  <span class="lib-acts" @click.stop>
                    <button type="button" class="lib-act" title="编辑" @click="lib.startEdit(m)"><Icon name="pen" :size="15" /></button>
                    <button type="button" class="lib-act" title="这是我自己的经历或数据：挪到个人档案" @click="lib.toProfile(m)"><Icon name="user" :size="15" /></button>
                    <button type="button" class="lib-act rm" title="删除" @click="lib.remove(m)"><Icon name="trash" :size="15" /></button>
                  </span>
                </div>
              </article>
            </div>

            <div class="lib-foot">
              <span class="lib-count">
                共 {{ rows.length }} 条素材<template v-if="lib.kind || lib.tag || lib.q">（筛选自 {{ lib.list.length }} 条）</template>，已选择 {{ lib.checked.length }} 条
                <button v-if="lib.checked.length" type="button" class="btn danger small" id="libBatchDel" @click="lib.removeChecked()">
                  <Icon name="trash" :size="13" />删除选中
                </button>
              </span>
              <nav v-if="pages > 1" class="lib-pager" aria-label="翻页">
                <button type="button" :disabled="lib.page <= 1" title="上一页" @click="lib.page -= 1"><Icon name="chev-left" :size="14" /></button>
                <template v-for="(p, i) in pageList" :key="i">
                  <span v-if="p === '…'" class="gap">…</span>
                  <button v-else type="button" :class="{ on: p === lib.page }" @click="lib.page = p">{{ p }}</button>
                </template>
                <button type="button" :disabled="lib.page >= pages" title="下一页" @click="lib.page += 1"><Icon name="chev-right" :size="14" /></button>
              </nav>
            </div>
          </template>
        </section>

        <!-- 右：素材详情 -->
        <aside v-if="detail" class="lib-detail" id="libDetail">
          <div class="lib-detail-head">
            <h3>素材详情</h3>
            <button type="button" class="icon-btn" title="关闭" @click="lib.selectedId = null"><Icon name="x" /></button>
          </div>

          <div class="lib-detail-hero">
            <span class="lib-thumb big" :data-kind="detail.kind">
              <img v-if="materialImage(detail)" :src="materialImage(detail)" alt="" />
              <Icon v-else :name="kindIcon(detail.kind)" :size="26" />
            </span>
            <div>
              <span class="mat-kind" :data-kind="detail.kind"><Icon :name="kindIcon(detail.kind)" :size="12" />{{ detail.kind }}</span>
              <b>{{ detail.title }}</b>
            </div>
          </div>

          <div class="lib-detail-block">
            <div class="lib-detail-label">
              <b>正文 / 来源摘要</b>
              <button type="button" class="lib-act" title="复制正文" @click="copyBody(materialText(detail))"><Icon name="copy" :size="14" /></button>
              <button type="button" class="lib-act" title="编辑" @click="lib.startEdit(detail)"><Icon name="pen" :size="14" /></button>
            </div>
            <a v-if="materialImage(detail)" class="lib-detail-img" :href="materialImage(detail)" target="_blank" rel="noopener">
              <img :src="materialImage(detail)" alt="素材图片" />
            </a>
            <div class="lib-detail-body">{{ materialText(detail) || '（没有文字）' }}</div>
          </div>

          <div v-if="materialUrl(detail)" class="lib-detail-block">
            <div class="lib-detail-label"><b>来源链接</b></div>
            <a class="lib-source" :href="materialUrl(detail)" target="_blank" rel="noopener noreferrer">
              <Icon name="link" :size="14" /><span>{{ materialUrl(detail) }}</span><Icon name="external" :size="14" />
            </a>
          </div>

          <div class="lib-detail-block">
            <div class="lib-detail-label"><b>标签</b></div>
            <div class="lib-tags wrap">
              <span v-for="(t, i) in tagList(detail.tags)" :key="i" class="first">{{ t }}</span>
              <form v-if="tagAdding" class="lib-tag-add" @submit.prevent="addTag">
                <input ref="tagInput" v-model="newTag" maxlength="20" placeholder="新标签" @keydown.esc="tagAdding = false" @blur="addTag" />
              </form>
              <button v-else type="button" class="lib-tag-add-btn" @click="openTagAdd"><Icon name="plus" :size="13" />添加标签</button>
            </div>
          </div>

          <div class="lib-detail-block">
            <div class="lib-detail-label"><b>使用情况</b></div>
            <p class="lib-usage">写作时用过 <b>{{ detail.used_count || 0 }}</b> 次 · 更新于 {{ stamp(detail.updated_at || detail.created_at) }}</p>
          </div>

          <div class="lib-detail-foot">
            <button v-if="lib.isLocalFolder(detail)" type="button" class="btn ghost" id="libRefreshFolder"
              @click="pickFolderRefresh(detail)"><Icon name="refresh" :size="14" />刷新目录</button>
            <button type="button" class="btn primary grow" @click="lib.startEdit(detail)"><Icon name="pen" :size="14" />编辑素材</button>
            <button type="button" class="btn danger" title="删除" @click="lib.remove(detail)"><Icon name="trash" :size="14" /></button>
          </div>
          <p class="lib-disclaimer">素材仅作参考，不会编造——写作时按题材召回，模型只用素材里的真东西。</p>
        </aside>
      </div>

      <!-- —— 选题灵感（选题池） —— -->
      <section v-else class="lib-main lib-pool">
        <div class="lib-pool-head">
          <div>
            <h3><Icon name="bulb" :size="17" />选题灵感</h3>
            <p class="hint">热点里看到的、推荐里想留的，先存这里；排期可空。按左侧当前账号筛选，完整蹭热点流程在顶栏「热点」。</p>
          </div>
          <button type="button" class="btn ghost small" @click="s.view = 'hot'">去热点<Icon name="arrow-right" :size="14" /></button>
        </div>
        <div class="pool-add library-pool-add">
          <input v-model="lib.poolForm.subject" maxlength="200" placeholder="题材：想到什么先记一条" @keydown.enter.prevent="lib.addPool()" />
          <input v-model="lib.poolForm.plan_date" type="date" title="排到哪天" />
          <button type="button" class="btn primary small" @click="lib.addPool()">存入</button>
        </div>
        <div v-if="!poolRows.length" class="pool-empty lib-empty">
          <Icon name="bulb" :size="28" />
          <b>{{ lib.pool.length ? '没有符合搜索的选题' : '选题池还是空的' }}</b>
          <span>在「热点」比对后点「用这个题材」，或在创作简报里把推荐题材存进来。</span>
          <button type="button" class="btn primary small" @click="s.view = 'hot'">打开热点</button>
        </div>
        <div v-else class="lib-table pool-table">
          <div class="lib-tr lib-th"><span>来源</span><span>题材</span><span>排期</span><span>状态</span><span class="end">操作</span></div>
          <div v-for="x in poolRows" :key="x.id" class="lib-tr" :class="{ done: x.status === 'done' }">
            <span class="src">{{ x.source }}</span>
            <div class="lib-pool-main">
              <b>{{ x.subject }}</b>
              <p v-if="x.note">{{ x.note }}</p>
              <em v-if="personaName(x.persona_id)" class="persona-tag">{{ personaName(x.persona_id) }}</em>
            </div>
            <input type="date" :value="x.plan_date" @change="lib.datePool(x.id, $event.target.value)" />
            <span class="lib-status" :data-st="x.status">{{ statusLabel(x.status) }}</span>
            <span class="lib-acts">
              <button type="button" class="btn soft small" :disabled="x.status === 'done'" @click="lib.writePool(x)">写这条</button>
              <button type="button" class="lib-act rm" title="删除" @click="lib.removePool(x)"><Icon name="trash" :size="15" /></button>
            </span>
          </div>
        </div>
      </section>
    </template>
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import Icon from './common/Icon.vue';
import MaterialForm from './MaterialForm.vue';
import { useStudioStore } from '../stores/studio.js';
import { kindIcon, materialImage, materialText, materialUrl, tagList, useLibraryStore } from '../stores/library.js';
import { stamp } from '../lib/text.js';
import { toast } from '../lib/feedback.js';

const s = useStudioStore();
const lib = useLibraryStore();
const folderInput = ref(null);
const searchInput = ref(null);
const tagInput = ref(null);
const refreshTarget = ref(null);
const moreOpen = ref(false);
const filterOpen = ref(false);
const tagAdding = ref(false);
const newTag = ref('');
const isMac = /Mac|iPhone|iPad/.test(globalThis.navigator?.platform || '');

/* 工具条上直接露出的种类；其余（框架参考、对标账号）收在「更多筛选」里 */
const QUICK_KINDS = ['文章', '图片', '视频', '链接', '语音'];

const rows = computed(() => lib.filtered());
const pageRows = computed(() => lib.paged(rows.value));
const pages = computed(() => lib.pageCount(rows.value));
const detail = computed(() => lib.selected());
const counts = computed(() => lib.countsByKind());
const tagCounts = computed(() => lib.countsByTag());
const otherKinds = computed(() => lib.kinds.filter((k) => !QUICK_KINDS.includes(k)));
const otherKindOn = computed(() => otherKinds.value.includes(lib.kind));
const filterLabel = computed(() => {
  const n = (lib.tag ? 1 : 0) + (otherKindOn.value ? 1 : 0);
  return n ? `更多筛选 · ${n}` : '更多筛选';
});
const poolRows = computed(() => {
  const needle = lib.q.trim().toLowerCase();
  if (!needle) return lib.pool;
  return lib.pool.filter((x) => `${x.subject} ${x.note || ''}`.toLowerCase().includes(needle));
});

/* 本页全选 */
const allChecked = computed(() => pageRows.value.length > 0 && pageRows.value.every((m) => lib.checked.includes(m.id)));
const someChecked = computed(() => !allChecked.value && pageRows.value.some((m) => lib.checked.includes(m.id)));
function toggleAll() {
  const ids = pageRows.value.map((m) => m.id);
  lib.checked = allChecked.value
    ? lib.checked.filter((id) => !ids.includes(id))
    : [...new Set([...lib.checked, ...ids])];
}

/* 页码：1 … 4 5 6 … 33 */
const pageList = computed(() => {
  const n = pages.value;
  const cur = lib.page;
  if (n <= 7) return Array.from({ length: n }, (_, i) => i + 1);
  const set = [1, n, cur - 1, cur, cur + 1].filter((p) => p >= 1 && p <= n);
  const sorted = [...new Set(set)].sort((a, b) => a - b);
  const out = [];
  sorted.forEach((p, i) => {
    if (i && p - sorted[i - 1] > 1) out.push('…');
    out.push(p);
  });
  return out;
});

watch(() => s.view, (view) => {
  if (view === 'library') lib.open();
});
watch(() => lib.selectedId, () => { tagAdding.value = false; });

/* ⌘K / Ctrl+K 聚焦搜索；点空白处关掉下拉 */
function onKey(e) {
  if (s.view !== 'library' || lib.form.open) return;
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    searchInput.value?.focus();
  }
}
function onDocClick() { moreOpen.value = false; filterOpen.value = false; }
onMounted(() => { document.addEventListener('keydown', onKey); document.addEventListener('click', onDocClick); });
onBeforeUnmount(() => { document.removeEventListener('keydown', onKey); document.removeEventListener('click', onDocClick); });

function personaName(id) {
  if (id == null) return '';
  return s.personas.find((p) => p.id === id)?.name || '';
}
function statusLabel(st) {
  return ({ idea: '待选', planned: '已排期', done: '已写成' })[st] || st;
}
function pickFolder() {
  refreshTarget.value = null;
  folderInput.value?.click();
}
function pickFolderRefresh(m) {
  refreshTarget.value = m;
  toast('请再选一次同一本地文件夹');
  folderInput.value?.click();
}
async function onFolderPicked(ev) {
  const input = ev.target;
  const target = refreshTarget.value;
  refreshTarget.value = null;
  try {
    if (target) await lib.refreshFolder(target, input.files);
    else await lib.importFolder(input.files);
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
async function openTagAdd() {
  newTag.value = '';
  tagAdding.value = true;
  await nextTick();
  tagInput.value?.focus();
}
async function addTag() {
  if (!tagAdding.value) return;
  const t = newTag.value.trim();
  tagAdding.value = false;
  if (t && detail.value) await lib.addTag(detail.value, t);
}
</script>
