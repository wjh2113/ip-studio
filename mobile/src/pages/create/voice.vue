<template>
  <view class="page voice">
    <!-- 通勤改稿：按住说怎么改 → 看改前改后 → 采用 / 重说 / 取消 -->
    <view class="card">
      <view class="seg">
        <view class="seg-i" :class="{ on: scope === 'part' }" @tap="pickScope('part')">选中段</view>
        <view class="seg-i" :class="{ on: scope === 'all' }" @tap="pickScope('all')">整篇</view>
      </view>
      <view v-if="scope === 'part'" class="focus">{{ focusText || '回阅读页点一段，再来这里' }}</view>
      <view v-else class="hint" style="margin-top: 20rpx">说清楚改哪里：「第二段改短点」「结尾换成提问」「把『其实』都删掉」</view>
    </view>

    <view v-if="result" class="card">
      <view class="heard"><Ic name="mic" :size="28" color="#2f6bff" />听到：{{ result.transcript }}</view>
      <view v-if="result.note" class="hint">理解成：{{ result.note }}</view>
      <template v-if="span.before.length || span.after.length">
        <view class="cmp old"><view class="cmp-h">原文</view><view v-for="(l, i) in span.before" :key="`a${i}`" class="cmp-l">{{ l }}</view></view>
        <view class="cmp new"><view class="cmp-h">改后</view><view v-for="(l, i) in span.after" :key="`b${i}`" class="cmp-l">{{ l }}</view></view>
        <view v-if="scope === 'part' && outside" class="warn-t">注意：这次也改到了选中段以外的地方</view>
      </template>
      <view v-else class="hint">正文没有改。{{ (result.skipped || []).filter(Boolean).join('；') }}</view>
      <view class="row gap">
        <button class="btn" @tap="cancel">取消</button>
        <button class="btn" @tap="result = null">重说</button>
        <button class="btn primary grow" :disabled="!result.changed" @tap="apply">采用</button>
      </view>
    </view>

    <view class="talk-wrap">
      <view class="talk-hint">{{ state === 'rec' ? '松开结束，上滑取消' : state === 'busy' ? '正在听懂并改稿…' : '按住说话' }}</view>
      <view class="talk" :class="state" @touchstart.prevent="down" @touchend.prevent="up" @touchmove="move" @touchcancel="up">
        <Ic :name="state === 'busy' ? 'refresh' : 'mic'" :size="72" color="#ffffff" />
      </view>
      <view class="hint">例：「这段改短点」「语气活泼些」</view>
    </view>
  </view>
</template>

<script setup>
import { computed, ref } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import Ic from '../../components/Ic.vue';
import { api, uploadBytes } from '../../lib/api.js';
import { back, toast } from '../../lib/ui.js';
import { changedSpan, createRecorder } from '../../lib/recorder.js';

const draft = ref(null);
const scope = ref('all');
const focus = ref(null);       // { start, end }
const state = ref('idle');     // idle | rec | busy
const result = ref(null);
let id = 0;
let rec = null;
let cancelMove = false;
let startY = 0;

const focusText = computed(() => (focus.value && draft.value ? draft.value.content.slice(focus.value.start, focus.value.end) : ''));
const span = computed(() => changedSpan(draft.value?.content, result.value?.content));
/* 改动是不是超出了选中段：改前那截里有不在选中段里的行 */
const outside = computed(() => span.value.before.some((l) => !focusText.value.includes(l.trim())));

onLoad(async (q) => {
  id = Number(q.id);
  if (q.start !== '' && q.start != null && q.end) { focus.value = { start: Number(q.start), end: Number(q.end) }; scope.value = 'part'; }
  try { draft.value = (await api(`/drafts/${id}`)).draft; } catch (err) { toast(err.message); }
});

function pickScope(s) { scope.value = s; }

async function down(e) {
  if (state.value !== 'idle') return;
  cancelMove = false;
  startY = e.touches?.[0]?.clientY || 0;
  rec = createRecorder();
  try {
    await rec.start();
    state.value = 'rec';
    uni.vibrateShort?.({});
  } catch {
    toast('打不开麦克风，检查一下权限');
    state.value = 'idle';
  }
}
function move(e) {
  const y = e.touches?.[0]?.clientY || 0;
  cancelMove = startY - y > 80;
}
async function up() {
  if (state.value !== 'rec') return;
  const file = await rec.stop();
  if (cancelMove || !file) { state.value = 'idle'; return; }
  state.value = 'busy';
  try {
    result.value = await uploadBytes(`/drafts/${id}/voice-edit`, file.path, { type: file.type, filename: file.filename });
  } catch (err) {
    toast(err.message);
  } finally {
    state.value = 'idle';
  }
}

async function apply() {
  try {
    await api(`/drafts/${id}/content`, { method: 'PUT', body: { content: result.value.content, snapshot: true } });
    toast('已采用，上一版留在历史里', 'success');
    setTimeout(() => back(), 600);
  } catch (err) { toast(err.message); }
}
function cancel() { result.value = null; back(); }
</script>

<style lang="scss" scoped>
.voice { padding-top: 20rpx; min-height: 100vh; }
.focus { margin-top: 20rpx; padding: 20rpx; border-radius: 16rpx; background: #fff4c2; font-size: 28rpx; line-height: 1.7; }
.heard { display: flex; align-items: center; gap: 10rpx; font-size: 28rpx; font-weight: 600; margin-bottom: 8rpx; }
.cmp { margin-top: 20rpx; border-radius: 16rpx; padding: 16rpx 20rpx; font-size: 28rpx; line-height: 1.7; }
.cmp.old { background: var(--danger-soft); }
.cmp.old .cmp-l { text-decoration: line-through; color: #a5383b; }
.cmp.new { background: var(--ok-soft); }
.cmp-h { font-size: 22rpx; color: var(--muted); margin-bottom: 6rpx; }
.warn-t { font-size: 24rpx; color: var(--warn); margin-top: 12rpx; }
.row.gap { display: flex; gap: 16rpx; margin-top: 24rpx; }
.talk-wrap { position: fixed; left: 0; right: 0; bottom: calc(60rpx + env(safe-area-inset-bottom)); display: flex; flex-direction: column; align-items: center; gap: 20rpx; }
.talk-hint { font-size: 28rpx; color: var(--text); font-weight: 600; }
.talk { width: 180rpx; height: 180rpx; border-radius: 50%; background: var(--accent); display: flex; align-items: center; justify-content: center; box-shadow: 0 20rpx 40rpx -16rpx rgba(47, 107, 255, .7); }
.talk.rec { background: #f04438; transform: scale(1.08); box-shadow: 0 0 0 24rpx rgba(240, 68, 56, .15); }
.talk.busy { background: var(--faint); }
</style>
