<template>
  <view class="page q">
    <!-- 语音优先：点一下录音，松手不需要——再点一下结束，走服务端 /transcribe → AIapiMgr speech -->
    <view class="card voice">
      <view class="mic" :class="state" @tap="toggleRec">
        <Ic :name="state === 'busy' ? 'refresh' : 'mic'" :size="72" color="#ffffff" />
      </view>
      <view class="mic-t">{{ micText }}</view>
      <view class="mic-s">
        <text v-if="state === 'rec'" class="sec">{{ sec }}″</text>
        <text class="gate" :class="{ warn: !gatewayLive }">{{ gateHint }}</text>
      </view>
    </view>

    <view class="card main">
      <view class="label">转写成文字<span class="opt">（可改）</span></view>
      <textarea class="area" v-model="content" maxlength="2000" :auto-height="true"
        placeholder="点上面麦克风说一段，或直接打字；保存后进素材库" placeholder-class="ph" />
      <view class="acts">
        <view class="act" @tap="fromClipboard">
          <Ic name="clipboard" :size="32" color="#7c5cff" />
          <text>粘贴</text>
        </view>
        <view class="act" :class="{ on: autoSave }" @tap="autoSave = !autoSave">
          <Ic name="bolt" :size="32" :color="autoSave ? '#1f56e0' : '#98a2b3'" />
          <text>说完直接存</text>
        </view>
        <view class="grow"></view>
        <text class="cnt">{{ content.length }}/2000</text>
      </view>
    </view>

    <view class="card">
      <view class="label">内容性质<span class="opt">（可选）</span></view>
      <view class="picks">
        <view v-for="t in TAGS" :key="t" class="pick" :class="{ on: tagOn(t) }" @tap="toggleTag(t)">{{ t }}</view>
      </view>
    </view>

    <view v-if="!inbox.online" class="off"><Ic name="cloud-off" :size="26" color="#c76a00" />没有网络：先存手机，联网后自动上传</view>

    <view class="footer-pad"></view>
    <view class="footer">
      <button class="btn primary lg block" :disabled="busy || state === 'rec' || state === 'busy'" @tap="save">存进素材库</button>
    </view>
  </view>
</template>

<script setup>
import { computed, onUnmounted, ref } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import Ic from '../../components/Ic.vue';
import { uploadBytes } from '../../lib/api.js';
import { back, toast } from '../../lib/ui.js';
import { createRecorder } from '../../lib/recorder.js';
import { useInboxStore } from '../../stores/inbox.js';
import { useSessionStore } from '../../stores/session.js';

const TAGS = ['经历', '数据', '案例', '金句', '观察'];

const inbox = useInboxStore();
const session = useSessionStore();
const content = ref('');
const tags = ref([]);
const state = ref('idle'); // idle | rec | busy
const busy = ref(false);
const usedVoice = ref(false);
const autoSave = ref(true);
const sec = ref(0);
let rec = null;
let tick = null;

const gatewayLive = computed(() => Boolean(session.meta?.llm?.live));
const gateHint = computed(() => {
  const l = session.meta?.llm;
  if (!l) return '语音经服务端转写';
  return l.live ? `${l.label} · speech 转写` : '演示模式：未接网关密钥时回固定转写';
});
const micText = computed(() => ({
  idle: '点一下开始说',
  rec: '再说一下结束',
  busy: '正在经网关转成文字…',
})[state.value]);

onLoad((q) => {
  let t = q.text || '';
  try { t = decodeURIComponent(t); } catch { /* 已经解过码的原样用 */ }
  content.value = String(t).slice(0, 2000);
  if (q.auto === '0') autoSave.value = false;
  if (!session.meta) session.boot().catch(() => {});
});

onUnmounted(() => {
  clearInterval(tick);
  if (state.value === 'rec') rec?.stop?.().catch(() => {});
});

const tagOn = (t) => tags.value.includes(t);
function toggleTag(t) {
  tags.value = tagOn(t) ? tags.value.filter((x) => x !== t) : [...tags.value, t];
}

async function toggleRec() {
  if (state.value === 'busy' || busy.value) return;
  if (state.value === 'rec') { await finishRec(); return; }
  rec = createRecorder();
  try {
    await rec.start();
    state.value = 'rec';
    sec.value = 0;
    clearInterval(tick);
    tick = setInterval(() => {
      sec.value += 1;
      // 最长 2 分钟，到点自动停
      if (sec.value >= 120) finishRec();
    }, 1000);
  } catch {
    toast('打不开麦克风，请检查权限');
    state.value = 'idle';
  }
}

async function finishRec() {
  if (state.value !== 'rec') return;
  clearInterval(tick);
  const f = await rec.stop().catch(() => null);
  if (!f) { state.value = 'idle'; toast('没录到声音'); return; }
  if (sec.value < 1) { state.value = 'idle'; toast('说短了，再试一次'); return; }
  state.value = 'busy';
  try {
    const { text: t } = await uploadBytes('/transcribe', f.path, { type: f.type, filename: f.filename });
    const piece = String(t || '').trim();
    if (!piece) { toast('没有听清，请再说一次'); return; }
    content.value = content.value ? `${content.value}\n${piece}` : piece;
    usedVoice.value = true;
    toast(gatewayLive.value ? '已转成文字' : '演示转写已填上', 'success');
    if (autoSave.value) await save();
  } catch (err) {
    toast(err.status ? err.message : '转写失败：网络不通或网关未配置');
  } finally {
    if (state.value === 'busy') state.value = 'idle';
  }
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

async function save() {
  const body = content.value.trim();
  if (!body) { toast('先说一段或写点什么'); return; }
  if (busy.value) return;
  busy.value = true;
  const title = body.split('\n').find((l) => l.trim())?.trim().slice(0, 60) || '一条灵感';
  const kind = usedVoice.value ? '语音' : (/^https?:\/\//i.test(body) && body.split(/\s/).length <= 2 ? '链接' : '文章');
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
.voice { display: flex; flex-direction: column; align-items: center; gap: 16rpx; padding: 40rpx 28rpx 36rpx; }
.mic {
  width: 168rpx; height: 168rpx; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  background: var(--accent);
  box-shadow: 0 16rpx 40rpx -16rpx rgba(47, 107, 255, .55);
}
.mic.rec { background: #f04438; box-shadow: 0 16rpx 40rpx -16rpx rgba(240, 68, 56, .55); transform: scale(1.04); }
.mic.busy { background: #98a2b3; box-shadow: none; }
.mic-t { font-size: 30rpx; font-weight: 700; color: var(--text); }
.mic-s { display: flex; align-items: center; gap: 14rpx; font-size: 22rpx; color: var(--muted); }
.sec { color: #f04438; font-weight: 700; font-variant-numeric: tabular-nums; }
.gate.warn { color: var(--warn); }
.main { padding-bottom: 16rpx; }
.label .opt { margin-left: 10rpx; color: var(--faint); font-weight: 400; }
.area { width: 100%; min-height: 220rpx; font-size: 30rpx; line-height: 1.65; margin-top: 8rpx; }
.acts { display: flex; align-items: center; gap: 12rpx; margin-top: 20rpx; padding-top: 16rpx; border-top: 1rpx solid var(--line); }
.act {
  display: flex; align-items: center; gap: 8rpx; height: 60rpx; padding: 0 18rpx;
  border-radius: 999rpx; background: var(--panel-2); font-size: 24rpx; color: var(--text);
}
.act.on { background: var(--accent-soft); color: var(--accent-ink); }
.cnt { font-size: 22rpx; color: var(--faint); }
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
