<template>
  <view class="page">
    <StepBar :step="1" />
    <!-- 第一步：选题。手机上只放必需的：题材、栏目、写法框架、借势热点、从选题池选；平台调性默认跟账号走 -->
    <view class="card">
      <view class="label"><Ic name="pen" :size="30" color="#2f6bff" />输入你的选题</view>
      <view class="hint" style="margin: -4rpx 0 16rpx">写清楚想写什么、写给谁，越具体越准</view>
      <textarea class="area" v-model="c.form.subject" maxlength="200" :auto-height="true" placeholder="例：上班族如何在下班后快速提升自己？分享 3 个实用方法" placeholder-class="ph" />
      <view class="count">{{ c.form.subject.length }}/200</view>

      <template v-if="persona">
        <view class="label sec"><Ic name="layers" :size="28" color="#667085" />内容栏目<text class="opt">（可选）</text></view>
        <view class="picks">
          <view class="pick" :class="{ on: !c.sectionId }" @tap="pickSection(null)">常规创作</view>
          <view v-for="x in sections" :key="x.id" class="pick" :class="{ on: c.sectionId === x.id }" @tap="pickSection(x.id)">{{ x.name }}</view>
        </view>
        <view v-if="section?.fields?.length" class="inputs">
          <view class="inputs-h"><text>「{{ section.name }}」需要你提供</text><text class="truth">模型只用你填的，不会自己编</text></view>
          <view v-for="f in section.fields" :key="f.label" class="field">
            <view class="label sm">{{ f.label }}<text v-if="f.required" class="req">*</text><text v-if="f.hint" class="opt">{{ f.hint }}</text></view>
            <textarea class="area sm" v-model="c.inputs[f.label]" :auto-height="true" maxlength="1500" />
          </view>
        </view>
      </template>

      <view class="label sec"><Ic name="list" :size="28" color="#667085" />写法框架<text class="opt">（可选）</text></view>
      <view class="picks">
        <view class="pick" :class="{ on: !c.frameworkKey }" @tap="c.frameworkKey = null">不套框架</view>
        <view v-for="f in recs" :key="f.key" class="pick" :class="{ on: c.frameworkKey === f.key }" @tap="c.frameworkKey = f.key">{{ f.name }}</view>
      </view>

      <!-- 借势热点：上次比对出来的、这个号接得住的热点；点一下带上 -->
      <template v-if="hots.length">
        <view class="label sec"><Ic name="flame" :size="28" color="#ff6a00" />借势热点<view class="grow"></view><text class="link" @tap="nextHot">换一条</text></view>
        <view class="hot" :class="{ on: c.hotspot?.title === hot.origin?.title }" @tap="useHot(hot)">
          <view class="grow">
            <view class="hot-t ellipsis"># {{ hot.origin?.title }}</view>
            <view class="hot-s ellipsis">关联{{ hot.strength }} · {{ hot.subject }}</view>
          </view>
          <Ic :name="c.hotspot?.title === hot.origin?.title ? 'check-circle' : 'chev-right'" :size="32" :color="c.hotspot?.title === hot.origin?.title ? '#2f6bff' : '#98a2b3'" />
        </view>
        <view v-if="c.hotspot" class="hint">已借势：{{ c.hotspot.title }}　<text class="link" @tap="c.hotspot = null">不借了</text></view>
      </template>

      <view class="label sec"><Ic name="inbox" :size="28" color="#667085" />从选题池选用<view class="grow"></view><text class="link" @tap="tab('inspire')">更多</text></view>
      <view v-if="!pool.length" class="hint">选题池还空着。在「灵感」里随手记的选题会出现在这里。</view>
      <view v-for="x in pool.slice(0, 4)" :key="x.id" class="pool-i" @tap="usePool(x)">
        <text class="chip gray">{{ x.source }}</text>
        <text class="grow ellipsis">{{ x.subject }}</text>
        <Ic name="chev-right" :size="28" color="#98a2b3" />
      </view>

      <view class="params" @tap="showParams = !showParams">
        <text class="faint">发布平台</text><text>{{ session.platformLabel(c.form.platform) }}</text>
        <text class="faint">调性</text><text>{{ c.form.tone }}</text>
        <text class="faint">字数</text><text>{{ c.form.length }}</text>
        <view class="grow"></view><text class="link">{{ showParams ? '收起' : '修改' }}</text>
      </view>
      <view v-if="showParams" class="param-form">
        <picker :range="platforms" range-key="label" :value="platformIdx" @change="onPlatform"><view class="input pick-in">{{ session.platformLabel(c.form.platform) }}</view></picker>
        <picker :range="tones" range-key="key" :value="toneIdx" @change="(e) => (c.form.tone = tones[e.detail.value].key)"><view class="input pick-in">{{ c.form.tone }}</view></picker>
        <input class="input" type="number" v-model="c.form.length" placeholder="目标字数" />
      </view>
    </view>
    <view class="footer-pad"></view>
    <view class="footer">
      <button class="btn primary lg block" :loading="busy" :disabled="busy" @tap="submit"><Ic name="sparkles" :size="34" color="#ffffff" />出三个方向</button>
    </view>
  </view>
</template>

<script setup>
import { computed, ref, watch } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import StepBar from '../../components/StepBar.vue';
import Ic from '../../components/Ic.vue';
import { api } from '../../lib/api.js';
import { go, tab, toast } from '../../lib/ui.js';
import { useSessionStore } from '../../stores/session.js';
import { useAccountStore } from '../../stores/account.js';
import { useCreateStore } from '../../stores/create.js';

const session = useSessionStore();
const acc = useAccountStore();
const c = useCreateStore();
const sections = ref([]);
const recs = ref([]);
const pool = ref([]);
const hots = ref([]);
const hotIdx = ref(0);
const busy = ref(false);
const showParams = ref(false);

const persona = computed(() => acc.current);
const section = computed(() => sections.value.find((x) => x.id === c.sectionId) || null);
const platforms = computed(() => session.meta?.platforms || []);
const tones = computed(() => session.meta?.tones || []);
const platformIdx = computed(() => Math.max(0, platforms.value.findIndex((p) => p.key === c.form.platform)));
const toneIdx = computed(() => Math.max(0, tones.value.findIndex((t) => t.key === c.form.tone)));
const hot = computed(() => hots.value[hotIdx.value % (hots.value.length || 1)] || {});

/* 平台调性默认跟账号走 */
function applyDefaults() {
  const p = persona.value;
  c.form.platform = p?.platform || c.form.platform || platforms.value[0]?.key || '';
  c.form.tone = p?.tone || c.form.tone || tones.value[0]?.key || '';
  c.form.audience = p?.audience || '';
  syncLength();
}
function syncLength() {
  const len = platforms.value.find((x) => x.key === c.form.platform)?.length;
  if (len) c.form.length = len;
}
function onPlatform(e) {
  c.form.platform = platforms.value[e.detail.value].key;
  syncLength();
  loadRecs();
}

async function loadAll() {
  applyDefaults();
  const pid = persona.value?.id;
  sections.value = [];
  hots.value = [];
  if (pid) {
    api(`/personas/${pid}/sections`).then((r) => { sections.value = r.sections || []; }).catch(() => {});
    api(`/personas/${pid}/hotspots`).then((r) => { hots.value = r.hotspots?.matches || []; }).catch(() => {});
  }
  api(`/pool${pid ? `?persona=${pid}` : ''}`).then((r) => { pool.value = (r.pool || []).filter((x) => x.status !== 'done'); }).catch(() => {});
  loadRecs();
}

async function loadRecs() {
  const q = [`platform=${encodeURIComponent(c.form.platform || '')}`];
  if (c.sectionId) q.push(`section_id=${c.sectionId}`);
  if (persona.value) q.push(`persona_id=${persona.value.id}`);
  try { recs.value = ((await api(`/frameworks/recommend?${q.join('&')}`)).frameworks || []).slice(0, 4); } catch { recs.value = []; }
}

function pickSection(id) {
  c.sectionId = id;
  const def = sections.value.find((x) => x.id === id)?.default_framework;
  if (def) c.frameworkKey = def;
  loadRecs();
}

function nextHot() { hotIdx.value += 1; }
function useHot(m) {
  c.form.subject = m.subject || c.form.subject;
  c.hotspot = {
    title: m.origin?.title || '', url: m.origin?.url || '', platform: m.origin?.platform || '',
    summary: m.origin?.summary || '', summarySource: m.origin?.summarySource || 'none', angle: m.angle,
  };
}
function usePool(x) {
  c.form.subject = x.subject;
  c.poolId = x.id;
}

async function submit() {
  if (busy.value) return;
  if (!c.form.subject.trim()) { toast('先写一句题材'); return; }
  const missing = (section.value?.fields || []).filter((f) => f.required && !String(c.inputs[f.label] || '').trim()).map((f) => f.label);
  if (missing.length) { toast(`先补上：${missing.join('、')}`); return; }
  const body = { ...c.form, persona_id: persona.value?.id ?? '' };
  if (c.hotspot) body.hotspot = c.hotspot;
  if (c.sectionId) {
    body.section_id = c.sectionId;
    const got = Object.fromEntries(Object.entries(c.inputs).filter(([, v]) => String(v || '').trim()));
    if (Object.keys(got).length) body.inputs = got;
  }
  if (c.frameworkKey) body.framework = c.frameworkKey;
  busy.value = true;
  try {
    const { draft } = await api('/drafts/topics', { method: 'POST', body });
    if (c.poolId) api(`/pool/${c.poolId}`, { method: 'PUT', body: { status: 'done' } }).catch(() => {});
    c.reset();
    go('create/topics', { id: draft.id });
  } catch (err) {
    toast(err.message);
  } finally {
    busy.value = false;
  }
}

watch(() => acc.currentId, loadAll);
onShow(() => { if (session.user) loadAll(); });
</script>

<style lang="scss" scoped>
.count { text-align: right; font-size: 22rpx; color: var(--faint); margin-top: 8rpx; }
.label.sec { margin-top: 36rpx; }
.label.sm { font-size: 24rpx; }
.req { color: var(--danger); }
.link { color: var(--accent-ink); font-size: 24rpx; font-weight: 400; }
.inputs { margin-top: 20rpx; padding: 20rpx; border-radius: 16rpx; background: #f4f7ff; border: 2rpx solid var(--accent-line); }
.inputs-h { display: flex; flex-direction: column; gap: 4rpx; font-size: 26rpx; font-weight: 600; color: var(--accent-ink); margin-bottom: 16rpx; }
.truth { font-size: 22rpx; font-weight: 400; color: var(--muted); }
.area.sm { min-height: 100rpx; background: var(--panel); }
.hot { display: flex; align-items: center; gap: 16rpx; padding: 20rpx; border-radius: 16rpx; background: #fff6f0; border: 2rpx solid #ffe0cc; }
.hot.on { border-color: var(--accent); background: var(--accent-soft); }
.hot-t { font-size: 28rpx; font-weight: 600; }
.hot-s { font-size: 22rpx; color: var(--muted); margin-top: 4rpx; }
.pool-i { display: flex; align-items: center; gap: 16rpx; padding: 20rpx 0; border-bottom: 2rpx solid var(--border); font-size: 26rpx; }
.params { display: flex; align-items: center; flex-wrap: wrap; gap: 8rpx 14rpx; margin-top: 32rpx; padding: 20rpx; border-radius: 16rpx; background: var(--panel-2); font-size: 24rpx; }
.param-form { display: flex; flex-direction: column; gap: 16rpx; margin-top: 16rpx; }
.pick-in { display: flex; align-items: center; }
</style>
