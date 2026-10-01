<template>
  <view class="page">
    <StepBar :step="3" />
    <view v-if="!draft" class="wrap"><view class="skel" style="height: 60rpx; width: 70%"></view><view v-for="i in 6" :key="i" class="skel" style="height: 36rpx; margin-top: 24rpx"></view></view>
    <view v-else class="reader">
      <!-- 阅读态是默认：大字、一块一块；点一段选中，底栏「改一点 / 语音改」就针对这一段 -->
      <view class="r-title">{{ title }}</view>
      <view class="r-meta">
        <text class="chip gray"><Ic name="doc" :size="22" color="#667085" />约 {{ chars }} 字</text>
        <text class="chip">{{ session.platformLabel(draft.platform) }}</text>
        <text v-if="draft.archived_at" class="chip warn">已归档</text>
        <text v-if="draft.published_at" class="chip ok">已发布 {{ draft.published_at.slice(5, 10) }}</text>
      </view>
      <view v-for="(b, i) in body" :key="b.start" class="blk" :class="[b.type, { sel: sel === i }]" @tap="toggle(i)">
        <view v-if="b.type === 'hr'" class="hr"></view>
        <text v-else selectable>{{ b.type === 'li' ? '· ' : '' }}{{ b.text }}</text>
      </view>
      <view v-if="!body.length" class="empty">这篇还没有正文。回上一步选个方向写。</view>
    </view>

    <view class="footer-pad"></view>
    <view class="bar">
      <view class="bar-i main" @tap="tweak"><Ic name="pen" :size="38" color="#ffffff" /><text>改一点</text></view>
      <view class="bar-i" @tap="voice"><Ic name="mic" :size="38" color="#2f6bff" /><text>语音改</text></view>
      <view class="bar-i" @tap="go('create/package', { id })"><Ic name="calendar" :size="38" color="#1b2232" /><text>发布包</text></view>
      <view class="bar-i" @tap="more = true"><Ic name="dots" :size="38" color="#1b2232" /><text>更多</text></view>
    </view>

    <!-- 改一点：只针对选中的那一段；没选就提示先点一段 -->
    <Sheet v-model="tweakOpen" title="改这一段" :sub="sel >= 0 ? '' : '先在正文里点一段'">
      <view v-if="sel >= 0" class="quote">{{ body[sel]?.text }}</view>
      <view class="acts">
        <view v-for="a in ASSIST" :key="a.key" class="act" @tap="runAssist(a)">{{ a.label }}</view>
      </view>
      <view class="field" style="margin-top: 20rpx">
        <input class="input" v-model="instruction" placeholder="或者直接说怎么改，回车确认" placeholder-class="ph" confirm-type="done" @confirm="runAssist({ key: 'custom', label: instruction })" />
      </view>
      <view v-if="assist.busy" class="hint">正在改…</view>
      <view v-if="assist.text" class="result">
        <view class="r-h">改成：</view>
        <view class="r-t">{{ assist.text }}</view>
        <view class="row gap">
          <button class="btn small" @tap="assist.text = ''">不要</button>
          <button class="btn small" @tap="runAssist(assist.last)">重来</button>
          <button class="btn small primary" @tap="applyAssist">采用</button>
        </view>
      </view>
    </Sheet>

    <!-- 更多：轻量菜单，一屏放完 -->
    <Sheet v-model="more" title="更多">
      <view class="grid">
        <view v-for="m in MORE" :key="m.key" class="grid-i" @tap="moreAct(m.key)">
          <view class="grid-ic"><Ic :name="m.icon" :size="40" color="#2f6bff" /></view>
          <text>{{ m.label }}</text>
          <text v-if="m.sub" class="grid-sub">{{ m.sub }}</text>
        </view>
      </view>
    </Sheet>
  </view>
</template>

<script setup>
import { computed, reactive, ref } from 'vue';
import { onLoad, onShow } from '@dcloudio/uni-app';
import StepBar from '../../components/StepBar.vue';
import Ic from '../../components/Ic.vue';
import Sheet from '../../components/Sheet.vue';
import { api, streamAll } from '../../lib/api.js';
import { confirm, go, toast } from '../../lib/ui.js';
import { blocks, countChars, splitTitle } from '../../lib/text.js';
import { useSessionStore } from '../../stores/session.js';

const ASSIST = [
  { key: 'shorten', label: '缩短点' }, { key: 'casual', label: '口语点' }, { key: 'professional', label: '专业点' },
  { key: 'expand', label: '展开说' }, { key: 'example', label: '举个例子' }, { key: 'simplify', label: '更好懂' },
];
const MORE = [
  { key: 'titles', label: '标题候选', icon: 'tag' },
  { key: 'illus', label: '配图', sub: '可存相册', icon: 'image' },
  { key: 'speak', label: '口播', icon: 'mic' },
  { key: 'metrics', label: '回填数据', icon: 'chart' },
  { key: 'learn', label: '喂给语气', icon: 'user' },
  { key: 'review', label: '审稿', icon: 'shield' },
  { key: 'published', label: '标为已发布', icon: 'check-circle' },
  { key: 'archive', label: '归档', icon: 'archive' },
  { key: 'jobs', label: '任务', icon: 'clipboard' },
];

const session = useSessionStore();
const draft = ref(null);
const sel = ref(-1);
const more = ref(false);
const tweakOpen = ref(false);
const instruction = ref('');
const assist = reactive({ busy: false, text: '', last: null, target: null });
let id = 0;

const head = computed(() => splitTitle(draft.value?.content));
const title = computed(() => head.value.title || draft.value?.title || draft.value?.subject || '');
/* 正文块：去掉文首标题那一行（块的位置仍然是相对整篇原文的） */
const body = computed(() => blocks(draft.value?.content).filter((b) => b.start >= head.value.offset || !head.value.title));
const chars = computed(() => countChars(draft.value?.content).toLocaleString());

async function load() {
  try { draft.value = (await api(`/drafts/${id}`)).draft; } catch (err) { toast(err.message); }
}
onLoad((q) => { id = Number(q.id); load(); });
onShow(() => { if (id && draft.value) load(); });

function toggle(i) { sel.value = sel.value === i ? -1 : i; }

function tweak() {
  if (sel.value < 0) { toast('先点一段要改的'); return; }
  assist.text = '';
  tweakOpen.value = true;
}

function voice() {
  go('create/voice', { id, start: sel.value >= 0 ? body.value[sel.value].start : '', end: sel.value >= 0 ? body.value[sel.value].end : '' });
}

async function runAssist(a) {
  const b = body.value[sel.value];
  if (!b || assist.busy) return;
  if (a.key === 'custom' && !instruction.value.trim()) return;
  if (a.key === 'custom' && b.raw.length > 300) { toast('这段太长，用上面的快捷改法'); return; }
  assist.busy = true;
  assist.text = '';
  assist.last = a;
  assist.target = { start: b.start, end: b.end, raw: b.raw };
  const raw = draft.value.content;
  try {
    // 快捷动作走「改写」；自己说的要求走「续写」通道，让模型在这个位置写出改好的一段来替换（改写接口只认固定动作）
    const ctx = { before: raw.slice(Math.max(0, b.start - 600), b.start), after: raw.slice(b.end, b.end + 600) };
    const body = a.key === 'custom'
      ? { kind: 'compose', instruction: `把原来这一段按要求改写，只输出改好的这一段。原文：「${b.raw.slice(0, 300)}」要求：${instruction.value.trim().slice(0, 120)}`, ...ctx }
      : { kind: 'rewrite', action: a.key, selection: b.raw, ...ctx };
    const events = await streamAll(`/drafts/${id}/assist`, body);
    const done = events.find((e) => e.event === 'done');
    assist.text = (done?.data?.text || events.filter((e) => e.event === 'delta').map((e) => e.data.text).join('')).trim();
  } catch (err) {
    toast(err.message);
  } finally {
    assist.busy = false;
  }
}

async function applyAssist() {
  const t = assist.target;
  const raw = draft.value.content;
  if (!t || raw.slice(t.start, t.end) !== t.raw) { toast('这段已经变了，重新选一次'); return; }
  const next = raw.slice(0, t.start) + assist.text + raw.slice(t.end);
  await save(next);
  tweakOpen.value = false;
  sel.value = -1;
  toast('已采用', 'success');
}

async function save(content) {
  try {
    const { draft: d } = await api(`/drafts/${id}/content`, { method: 'PUT', body: { content, snapshot: true } });
    draft.value = d || { ...draft.value, content };
  } catch (err) { toast(err.message); }
}

async function moreAct(key) {
  more.value = false;
  const d = draft.value;
  if (key === 'titles') go('create/titles', { id });
  else if (key === 'illus') go('create/illus', { id });
  else if (key === 'speak') go('speak/record', { id });
  else if (key === 'metrics') go('metrics/fill', { id });
  else if (key === 'review') go('create/review', { id });
  else if (key === 'jobs') go('jobs/index');
  else if (key === 'learn') {
    if (!d.persona_id) { toast('这篇没有绑定账号'); return; }
    if (!(await confirm({ title: '把这篇喂给账号学语气？', content: '之后这个号的成稿会模仿它的语感，可以随时在样本里删掉。', ok: '喂进去' }))) return;
    try {
      const { digest } = await api(`/personas/${d.persona_id}/samples`, { method: 'POST', body: { draft_id: d.id } });
      toast(digest ? '学好了，语气档案已更新' : '已加入样本');
    } catch (err) { toast(err.message); }
  } else if (key === 'published') {
    const on = !d.published_at;
    try {
      const { draft: x } = await api(`/drafts/${id}/published`, { method: 'PUT', body: { date: on ? new Date().toISOString().slice(0, 10) : '' } });
      draft.value = { ...d, published_at: x.published_at };
      toast(on ? '已标为发布，第 1、7 天会提醒你回填' : '已取消发布标记');
    } catch (err) { toast(err.message); }
  } else if (key === 'archive') {
    if (!(await confirm({ title: '归档这篇？', content: '收进已归档，随时能恢复。' }))) return;
    try {
      await api(`/drafts/${id}/archive`, { method: 'POST', body: { archived: true } });
      toast('已归档');
      load();
    } catch (err) { toast(err.message); }
  }
}
</script>

<style lang="scss" scoped>
.reader { padding: 8rpx 36rpx 0; }
.r-title { font-size: 44rpx; font-weight: 800; line-height: 1.4; }
.r-meta { display: flex; flex-wrap: wrap; gap: 12rpx; margin: 20rpx 0 28rpx; }
.blk { font-size: 34rpx; line-height: 1.85; padding: 6rpx 10rpx; margin: 0 -10rpx 18rpx; border-radius: 12rpx; }
.blk.h2 { font-size: 38rpx; font-weight: 700; margin-top: 30rpx; }
.blk.h3, .blk.h4 { font-size: 34rpx; font-weight: 700; margin-top: 20rpx; }
.blk.li, .blk.oli { padding-left: 20rpx; margin-bottom: 8rpx; }
.blk.quote { color: var(--muted); border-left: 6rpx solid var(--accent-line); padding-left: 20rpx; }
.blk.sel { background: #fff4c2; box-shadow: 0 0 0 4rpx #ffe58a; }
.hr { height: 2rpx; background: var(--border); margin: 20rpx 0; }
.bar {
  position: fixed; left: 0; right: 0; bottom: 0; z-index: 30; display: flex; gap: 12rpx;
  padding: 16rpx 24rpx calc(16rpx + env(safe-area-inset-bottom)); background: #fff; border-top: 2rpx solid var(--border);
}
.bar-i { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 4rpx; padding: 12rpx 0; border-radius: 16rpx; font-size: 22rpx; color: var(--text); }
.bar-i.main { background: var(--accent); color: #fff; }
.quote { font-size: 26rpx; color: var(--muted); background: var(--panel-2); border-radius: 12rpx; padding: 16rpx 20rpx; margin-bottom: 20rpx; max-height: 200rpx; overflow: hidden; }
.acts { display: flex; flex-wrap: wrap; gap: 16rpx; }
.act { padding: 14rpx 26rpx; border-radius: 30rpx; background: var(--accent-soft); color: var(--accent-ink); font-size: 26rpx; }
.result { margin-top: 20rpx; padding: 20rpx; border-radius: 16rpx; border: 2rpx solid var(--accent-line); }
.r-h { font-size: 24rpx; color: var(--accent-ink); margin-bottom: 8rpx; }
.r-t { font-size: 28rpx; line-height: 1.75; margin-bottom: 20rpx; }
.row.gap { gap: 16rpx; justify-content: flex-end; }
.grid { display: flex; flex-wrap: wrap; }
.grid-i { width: 33.33%; display: flex; flex-direction: column; align-items: center; gap: 8rpx; padding: 24rpx 0; font-size: 26rpx; }
.grid-ic { width: 88rpx; height: 88rpx; border-radius: 24rpx; background: var(--accent-soft); display: flex; align-items: center; justify-content: center; }
.grid-sub { font-size: 20rpx; color: var(--faint); margin-top: -6rpx; }
</style>
