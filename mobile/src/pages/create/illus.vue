<template>
  <view class="page il">
    <!-- 配图：每张缩略图、画面说明、状态；能存相册、能重试。出图按张计费，在任务队列里做，关掉 App 也会接着出 -->
    <view class="il-h">
      <view><view class="il-t">配图</view><view class="hint">{{ summary }}</view></view>
      <view class="grow"></view>
      <button v-if="doneCount" class="btn small soft" :loading="savingAll" @tap="saveAll"><Ic name="download" :size="26" color="#1f56e0" />全部存相册</button>
    </view>
    <view v-if="denied" class="denied card">
      <Ic name="lock" :size="40" color="#c76a00" />
      <view class="grow"><view class="d-t">没有相册权限</view><view class="hint">在系统设置里允许「自媒体助手」访问照片，才能把图存下来。</view></view>
      <button class="btn small" @tap="openSettings">去设置</button>
    </view>

    <view v-if="!draft" class="wrap"><view class="skel" style="height: 200rpx"></view></view>
    <view v-else-if="!items.length" class="empty">
      <Ic name="image" :size="96" color="#98a2b3" />
      <view>还没排配图位。正文里写了「此处放图片」就插在那里，没写就按字数自动排。</view>
      <button class="btn primary" style="margin-top: 24rpx" :loading="planning" @tap="plan">排配图位</button>
    </view>

    <view v-for="it in items" :key="it.i" class="il-i card">
      <image v-if="it.image" :src="srcs[it.i] || ''" mode="aspectFill" class="thumb" @tap="preview(it)" />
      <view v-else class="thumb ph"><Ic :name="state(it) === 'running' ? 'refresh' : state(it) === 'failed' ? 'x' : 'image'" :size="40" :color="state(it) === 'failed' ? '#e5484d' : '#98a2b3'" /></view>
      <view class="grow il-b">
        <view class="il-n">{{ it.i + 1 }}. {{ it.alt || '配图' }}</view>
        <view class="il-p">{{ it.prompt }}</view>
        <view class="il-s">
          <text class="chip" :class="{ done: 'ok', running: '', failed: 'bad', todo: 'gray' }[state(it)]">{{ { done: '已出图', running: '生成中', failed: '失败', todo: '待生成' }[state(it)] }}</text>
          <view class="grow"></view>
          <text v-if="it.image" class="op" @tap="save(it)">存相册</text>
          <text v-if="state(it) !== 'running'" class="op" @tap="make(it)">{{ it.image ? '重出' : state(it) === 'failed' ? '重试' : '出这张' }}</text>
        </view>
      </view>
    </view>
    <view class="footer-pad"></view>
    <view v-if="items.length" class="footer">
      <button class="btn primary lg block" :disabled="!todoCount" @tap="makeAll">{{ todoCount ? `全部出图（${todoCount} 张）` : '每张都出过了' }}</button>
    </view>
  </view>
</template>

<script setup>
import { computed, reactive, ref, watch } from 'vue';
import { onLoad, onUnload } from '@dcloudio/uni-app';
import Ic from '../../components/Ic.vue';
import { api } from '../../lib/api.js';
import { confirm, toast } from '../../lib/ui.js';
import { authedImage, openSettings, saveToAlbum } from '../../lib/image.js';
import { useJobsStore } from '../../stores/jobs.js';

const MAIN = '__main__';
const jobs = useJobsStore();
const draft = ref(null);
const planning = ref(false);
const savingAll = ref(false);
const denied = ref(false);
const srcs = reactive({});
let id = 0;

const items = computed(() => draft.value?.illus?.[MAIN]?.items || []);
const imageUrl = (img) => `/image/${img.file}?v=${encodeURIComponent(img.at)}`;
const doneCount = computed(() => items.value.filter((x) => x.image).length);
const todoCount = computed(() => items.value.filter((x) => !x.image && state(x) !== 'running').length);
const summary = computed(() => (items.value.length ? `${items.value.length} 张 · 已出 ${doneCount.value}` : '成稿配图'));

/* 这一张现在的状态：看任务列表里有没有对应的出图任务 */
function jobOf(it) {
  return jobs.list.find((j) => j.kind === 'image' && j.payload?.draftId === id && (j.payload?.version || '') === '' && j.payload?.index === it.i);
}
function state(it) {
  const j = jobOf(it);
  if (j && (j.status === 'queued' || j.status === 'running')) return 'running';
  if (it.image) return 'done';
  if (j?.status === 'failed') return 'failed';
  return 'todo';
}

async function load() {
  try { draft.value = (await api(`/drafts/${id}`)).draft; } catch (err) { toast(err.message); }
}
onLoad((q) => { id = Number(q.id); load(); jobs.load(); });

watch(items, async (list) => {
  for (const it of list) if (it.image && !srcs[it.i]) srcs[it.i] = await authedImage(imageUrl(it.image));
}, { immediate: true });

// 任务做完：重新拉稿子，把图换上
const onDone = (j) => { if (j.kind === 'image' && j.payload?.draftId === id) { delete srcs[j.payload.index]; load(); } };
uni.$on('job-done', onDone);
onUnload(() => uni.$off('job-done', onDone));

async function plan() {
  planning.value = true;
  try {
    const out = await api(`/drafts/${id}/illus`, { method: 'POST', body: { version: '' } });
    draft.value = { ...draft.value, illus: { ...(draft.value.illus || {}), [MAIN]: out.illus } };
  } catch (err) { toast(err.message); } finally { planning.value = false; }
}

async function make(it) {
  try {
    await api(`/drafts/${id}/illus/${it.i}/image`, { method: 'POST', body: { version: '', async: true } });
    await jobs.load();
    toast('已加入出图队列');
  } catch (err) { toast(err.message); }
}

async function makeAll() {
  const todo = items.value.filter((x) => !x.image && state(x) !== 'running');
  if (!todo.length) return;
  if (!(await confirm({ title: `要出 ${todo.length} 张图`, content: '按张计费，在后台一张张出，好了会提示。', ok: '开始出图' }))) return;
  for (const it of todo) {
    try { await api(`/drafts/${id}/illus/${it.i}/image`, { method: 'POST', body: { version: '', async: true } }); }
    catch (err) { toast(`第 ${it.i + 1} 张：${err.message}`); break; }
  }
  jobs.load();
}

async function save(it) {
  const r = await saveToAlbum(imageUrl(it.image));
  if (r === 'denied') denied.value = true;
  else toast(r === 'ok' ? '已存到相册' : '保存失败', r === 'ok' ? 'success' : 'none');
}

async function saveAll() {
  savingAll.value = true;
  let n = 0;
  for (const it of items.value.filter((x) => x.image)) {
    const r = await saveToAlbum(imageUrl(it.image));
    if (r === 'denied') { denied.value = true; break; }
    if (r === 'ok') n += 1;
  }
  savingAll.value = false;
  if (n) toast(`已存 ${n} 张`, 'success');
}

function preview(it) {
  const urls = items.value.filter((x) => x.image).map((x) => srcs[x.i]).filter(Boolean);
  if (urls.length) uni.previewImage({ urls, current: srcs[it.i] });
}
</script>

<style lang="scss" scoped>
.il { padding-top: 12rpx; }
.il-h { display: flex; align-items: center; padding: 0 28rpx 20rpx; }
.il-t { font-size: 40rpx; font-weight: 800; }
.il-i { display: flex; gap: 20rpx; }
.thumb { width: 200rpx; height: 150rpx; border-radius: 14rpx; flex: none; background: var(--panel-2); }
.thumb.ph { display: flex; align-items: center; justify-content: center; border: 2rpx dashed var(--line-strong); }
.il-b { min-width: 0; }
.il-n { font-size: 28rpx; font-weight: 600; }
.il-p { font-size: 22rpx; color: var(--muted); line-height: 1.5; margin: 6rpx 0 10rpx; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.il-s { display: flex; align-items: center; gap: 20rpx; }
.op { font-size: 24rpx; color: var(--accent-ink); }
.denied { display: flex; align-items: center; gap: 20rpx; background: var(--warn-soft); }
.d-t { font-size: 28rpx; font-weight: 600; color: var(--warn); }
</style>
