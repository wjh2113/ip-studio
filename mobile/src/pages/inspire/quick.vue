<template>
  <view class="page q">
    <!-- 快速存素材：写完直接进素材库，不问账号、不拆种类；标题用第一句 -->
    <view class="card main">
      <textarea class="area" v-model="content" maxlength="2000" :auto-height="true" :focus="true"
        placeholder="想到什么写什么，保存后进素材库；标题自动取第一句" placeholder-class="ph" />
      <view class="acts">
        <view class="act" :class="{ on: state === 'rec' }" @touchstart.prevent="down" @touchend.prevent="up" @touchcancel="up">
          <Ic :name="state === 'busy' ? 'refresh' : 'mic'" :size="32" :color="state === 'rec' ? '#fff' : '#2f6bff'" />
          <text>{{ state === 'rec' ? '松开' : state === 'busy' ? '转写中' : '语音' }}</text>
        </view>
        <view class="act" @tap="fromClipboard">
          <Ic name="clipboard" :size="32" color="#7c5cff" />
          <text>粘贴</text>
        </view>
        <view class="grow"></view>
        <text class="cnt">{{ content.length }}/2000</text>
      </view>
    </view>

    <view class="card">
      <view class="label">内容性质<span class="opt">（可选，写作时更好召回）</span></view>
      <view class="picks">
        <view v-for="t in TAGS" :key="t" class="pick" :class="{ on: tagOn(t) }" @tap="toggleTag(t)">{{ t }}</view>
      </view>
    </view>

    <view v-if="!inbox.online" class="off"><Ic name="cloud-off" :size="26" color="#c76a00" />没有网络：先存手机，联网后自动上传</view>

    <view class="footer-pad"></view>
    <view class="footer">
      <button class="btn primary lg block" :disabled="busy" @tap="save">存进素材库</button>
    </view>
  </view>
</template>

<script setup>
import { ref } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import Ic from '../../components/Ic.vue';
import { uploadBytes } from '../../lib/api.js';
import { back, toast } from '../../lib/ui.js';
import { createRecorder } from '../../lib/recorder.js';
import { useInboxStore } from '../../stores/inbox.js';

const TAGS = ['经历', '数据', '案例', '金句', '观察'];

const inbox = useInboxStore();
const content = ref('');
const tags = ref([]);
const state = ref('idle');
const busy = ref(false);
const usedVoice = ref(false);
let rec = null;

onLoad((q) => {
  let t = q.text || '';
  try { t = decodeURIComponent(t); } catch { /* 已经解过码的原样用 */ }
  content.value = String(t).slice(0, 2000);
});

const tagOn = (t) => tags.value.includes(t);
function toggleTag(t) {
  tags.value = tagOn(t) ? tags.value.filter((x) => x !== t) : [...tags.value, t];
}

async function down() {
  if (state.value !== 'idle') return;
  rec = createRecorder();
  try { await rec.start(); state.value = 'rec'; } catch { toast('打不开麦克风'); }
}
async function up() {
  if (state.value !== 'rec') return;
  const f = await rec.stop();
  if (!f) { state.value = 'idle'; return; }
  state.value = 'busy';
  try {
    const { text: t } = await uploadBytes('/transcribe', f.path, { type: f.type, filename: f.filename });
    content.value = content.value ? `${content.value}\n${t}` : t;
    usedVoice.value = true;
  } catch (err) {
    toast(err.status ? err.message : '没网转不了文字，用输入法的语音输入吧');
  } finally { state.value = 'idle'; }
}

function fromClipboard() {
  uni.getClipboardData({
    success: (r) => {
      const text = String(r.data || '').trim();
      if (!text) { toast('剪贴板是空的'); return; }
      content.value = content.value ? `${content.value}\n${text}` : text.slice(0, 2000);
      toast('已贴上');
    },
    fail: () => toast('读不到剪贴板'),
  });
}

function save() {
  const body = content.value.trim();
  if (!body) { toast('先写点什么'); return; }
  if (busy.value) return;
  busy.value = true;
  const title = body.split('\n').find((l) => l.trim())?.trim().slice(0, 60) || '一条灵感';
  const kind = /^https?:\/\//i.test(body) && body.split(/\s/).length <= 2 ? '链接' : '文章';
  inbox.add({
    kind: 'material',
    input: usedVoice.value ? 'voice' : 'text',
    personaId: null,
    title,
    body: body.slice(0, 15000),
    materialKind: kind,
    tags: tags.value.join('，'),
  });
  toast(inbox.online ? '已存进素材库' : '已存本地，联网后自动上传', 'success');
  setTimeout(() => { busy.value = false; back('inspire'); }, 450);
}
</script>

<style lang="scss" scoped>
.q { padding-top: 20rpx; }
.main { padding-bottom: 16rpx; }
.area { width: 100%; min-height: 360rpx; font-size: 30rpx; line-height: 1.65; }
.acts { display: flex; align-items: center; gap: 16rpx; margin-top: 20rpx; padding-top: 16rpx; border-top: 1rpx solid var(--line); }
.act {
  display: flex; align-items: center; gap: 8rpx; height: 64rpx; padding: 0 20rpx;
  border-radius: 999rpx; background: var(--panel-2); font-size: 24rpx; color: var(--text);
}
.act.on { background: #f04438; color: #fff; }
.cnt { font-size: 22rpx; color: var(--faint); }
.label .opt { margin-left: 10rpx; color: var(--faint); font-weight: 400; }
.picks { display: flex; flex-wrap: wrap; gap: 12rpx; margin-top: 16rpx; }
.pick {
  height: 60rpx; padding: 0 22rpx; border-radius: 999rpx; border: 1rpx solid var(--line);
  display: flex; align-items: center; font-size: 26rpx; color: var(--muted); background: var(--panel);
}
.pick.on { border-color: transparent; background: var(--accent-soft); color: var(--accent-ink); font-weight: 600; }
.off {
  display: flex; align-items: center; gap: 10rpx; margin: 0 28rpx 16rpx;
  padding: 16rpx 20rpx; border-radius: 14rpx; background: var(--warn-soft); color: var(--warn); font-size: 24rpx;
}
</style>
