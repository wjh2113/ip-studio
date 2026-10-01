<template>
  <header class="docs-head">
    <div class="docs-head-in">
      <span class="brand-mark" aria-hidden="true"></span>
      <div>
        <h1>提示词说明书</h1>
        <p class="sub">自媒体助手 —— 每一条提示词的产品定位、价值与功能逻辑</p>
      </div>
      <a class="btn ghost small" href="/">回到产品</a>
    </div>
  </header>

  <div class="docs-body">
    <nav class="docs-nav" id="nav">
      <template v-for="st in stages" :key="st.key">
        <div v-if="byStage(st.key).length" class="grp"><b>{{ st.label }}　{{ st.blurb }}</b>
          <a v-for="p in byStage(st.key)" :key="p.key" :href="`#p-${p.key}`" :class="{ off: p.hidden, on: spy === `p-${p.key}` }">{{ p.name }}</a>
        </div>
      </template>
    </nav>
    <main class="docs-main">
      <p v-if="error" class="pd">{{ error }}</p>
      <template v-if="d">
        <section class="principle" id="principle"><h2>{{ d.principle.title }}</h2><p v-html="md(d.principle.body)"></p></section>
        <!-- user 消息怎么拼——比任何单条提示词都更能解释这个产品 -->
        <section v-if="d.assembly" class="principle assembly" id="assembly">
          <h2>{{ d.assembly.title }}</h2>
          <p v-html="md(d.assembly.intro)"></p>
          <ol class="asm"><li v-for="b in d.assembly.blocks" :key="b.name"><b>{{ b.name }}</b><i>{{ b.from }}</i><span v-html="md(b.note)"></span></li></ol>
        </section>
        <div id="list">
          <article v-for="p in ordered" :key="p.key" class="pd" :id="`p-${p.key}`" ref="items">
            <header>
              <h3>{{ p.name }}</h3>
              <span class="tag">{{ stageLabel(p.stage) }}</span>
              <span class="tag" :title="MODE_HINT[p.mode] || ''">{{ p.mode }}</span>
              <span v-if="p.ab" class="tag ab" title="管理后台可以挂变体做 A/B">A/B</span>
              <span v-if="p.customized" class="tag ab" title="当前发给模型的是手改过的一版">已手改</span>
              <span v-if="p.hidden" class="tag off" title="入口已从界面撤掉，代码还在">已隐藏</span>
            </header>
            <p class="where">出现在：{{ p.where }}</p>
            <h4>产品定位</h4>
            <p class="positioning" v-html="md(p.positioning)"></p>
            <h4>价值</h4>
            <ul><li v-for="(x, i) in p.value" :key="i" v-html="md(x)"></li></ul>
            <h4>功能逻辑</h4>
            <ul><li v-for="(x, i) in p.logic" :key="i" v-html="md(x)"></li></ul>
            <template v-if="p.guards?.length">
              <h4>代码兜底（提示词之外的那一层）</h4>
              <ul class="guards"><li v-for="(x, i) in p.guards" :key="i" v-html="md(x)"></li></ul>
            </template>
            <template v-for="(list, group) in p.extra || {}" :key="group">
              <h4>{{ group }}</h4>
              <div class="acts"><div v-for="a in list" :key="a.label" class="act"><b>{{ a.label }}</b><span>{{ a.instruction }}</span></div></div>
            </template>

            <details>
              <summary>实际发给模型的 system 提示词（<span>{{ (drafts[p.key] ?? p.system).length }}</span> 字）</summary>
              <template v-if="d.canEdit">
                <textarea class="prompt-edit" :data-prompt="p.key" :value="drafts[p.key] ?? p.system" @input="drafts[p.key] = $event.target.value"></textarea>
                <div class="prompt-acts">
                  <button type="button" class="btn primary small" :data-save-prompt="p.key" :disabled="saving === p.key" @click="save(p)">保存为新版本</button>
                  <span class="hint">{{ msgs[p.key] || '保存后，之后的生成用这一版。旧版留在下面。' }}</span>
                </div>
              </template>
              <template v-else>
                <pre>{{ drafts[p.key] ?? p.system }}</pre>
                <p class="hint">登录产品之后，可以在这里改。每次保存都留一版，不会盖掉以前的。</p>
              </template>
              <div v-if="p.history?.length" class="prompt-hist">
                <div v-for="h in p.history" :key="h.id" class="hist-row" :class="{ on: h.active }">
                  <span>{{ h.active ? '当前 · ' : '' }}{{ h.source === 'edit' ? '手改' : '代码' }} · {{ h.created_at.replace('T', ' ').slice(0, 16) }} · {{ h.chars }} 字</span>
                  <button type="button" @click="drafts[p.key] = h.system">查看</button>
                  <button v-if="d.canEdit && !h.active" type="button" @click="activate(p, h)">用这一版</button>
                </div>
              </div>
            </details>
            <details v-if="p.schema">
              <summary>输出结构约束（JSON Schema）</summary>
              <pre>{{ JSON.stringify(p.schema, null, 2) }}</pre>
            </details>
          </article>
        </div>
      </template>
      <footer class="docs-foot">
        这里显示的是<strong>当前实际发给模型的那一版</strong>。登录后可以直接改，每次保存都留档；
        代码里的提示词更新时也会记一版，不会盖掉你改过的内容。结构约束（JSON Schema）仍由代码固定，这里不改。
      </footer>
    </main>
  </div>
  <Toast />
  <AskDialog />
</template>

<script setup>
/* 提示词说明书：读 /api/prompt-docs；登录了产品的人可以直接改，每次保存都留一版 */
import { computed, nextTick, onBeforeUnmount, reactive, ref } from 'vue';
import Toast from '../components/common/Toast.vue';
import AskDialog from '../components/common/AskDialog.vue';
import { ask, toast } from '../lib/feedback.js';
import { esc } from '../lib/text.js';

const MODE_HINT = {
  结构化输出: '用 JSON Schema 约束返回结构，字段缺失或越界在代码里兜',
  流式输出: '边生成边推给前端，长等待变成可读的过程',
  纯文本: '返回一段文字，直接用',
};

/* 说明文字里用 **强调** 标关键词——读者是产品经理，扫读时需要落点 */
const md = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/`(.+?)`/g, '<code>$1</code>');

const d = ref(null);
const error = ref('');
const drafts = reactive({});      // 正在看或正在改的那一版（key → 文本）；没有就是当前版
const msgs = reactive({});
const saving = ref('');
const spy = ref('');
const items = ref([]);

const stages = computed(() => d.value?.stages || []);
const byStage = (key) => (d.value?.prompts || []).filter((p) => p.stage === key);
// 按阶段排，同阶段内保持定义顺序——读下来就是产品的实际流程
const ordered = computed(() => stages.value.flatMap((st) => byStage(st.key)));
const stageLabel = (key) => stages.value.find((s) => s.key === key)?.label || key;

let observer = null;

async function load() {
  try {
    const res = await fetch('/api/prompt-docs');
    d.value = await res.json();
    for (const k of Object.keys(drafts)) delete drafts[k];
  } catch {
    error.value = '读不到说明数据，确认服务在跑。';
    return;
  }
  // 滚到哪一条，左边就高亮哪一条
  await nextTick();
  observer?.disconnect();
  observer = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) spy.value = e.target.id;
  }, { rootMargin: '-90px 0px -70% 0px' });
  document.querySelectorAll('.pd[id]').forEach((n) => observer.observe(n));
}

async function save(p) {
  saving.value = p.key;
  try {
    const res = await fetch(`/api/prompt-docs/${p.key}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ system: drafts[p.key] ?? p.system }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) { msgs[p.key] = body.error || '没有保存成功'; return; }
    msgs[p.key] = '';
    toast('已保存为新版本');
    await load();
  } finally {
    saving.value = '';
  }
}

async function activate(p, h) {
  if (!await ask.confirm({ title: '之后的生成改用这一版？', body: '当前正在用的那一版会留在历史里，可以再切回去。', ok: '使用' })) return;
  const res = await fetch(`/api/prompt-docs/${p.key}/revisions/${h.id}/activate`, { method: 'POST' });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) { toast(body.error || '没有切换成功'); return; }
  await load();
}

load();
onBeforeUnmount(() => observer?.disconnect());
</script>
