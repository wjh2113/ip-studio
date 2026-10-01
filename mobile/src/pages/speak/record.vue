<template>
  <view class="rec" :class="[phase, { mirror: prefs.mirror }]">
    <!-- 口播录制：试镜（构图、光线、音量）→ 提词录制（画中画自拍 + 大字滚动提词）→ 交给任务队列评测。
         提词滚动和录像同时进行；网络差时先存本机，联网再交 -->
    <view class="rec-top" :style="{ paddingTop: `${statusH}px` }">
      <view class="tb-btn" @tap="leave"><Ic name="x" :size="36" color="#ffffff" /></view>
      <view class="grow center">
        <text v-if="phase === 'test'" class="rec-t">录前试镜</text>
        <view v-else-if="phase === 'rec'" class="rec-clock"><view class="dot" :class="{ on: recording }"></view>{{ clock }}</view>
        <text v-else class="rec-t">{{ phase === 'queued' ? '已入队' : '提交中' }}</text>
      </view>
      <view v-if="prefs.keepAwake && phase !== 'queued'" class="awake"><Ic name="sun" :size="24" color="#ffd479" />防息屏</view>
    </view>

    <!-- 摄像头：试镜时铺满，录制时缩成右上角的小窗 -->
    <view v-if="mode === 'video'" class="cam-box" :class="{ pip: phase !== 'test' }">
      <!-- #ifdef MP-WEIXIN -->
      <camera device-position="front" flash="off" class="cam" @error="camError" />
      <!-- #endif -->
      <!-- #ifdef H5 -->
      <view id="camHost" class="cam"></view>
      <!-- #endif -->
      <view v-if="phase === 'test'" class="frame"><view class="face"></view><text class="frame-t">人脸放在框里</text></view>
    </view>
    <view v-else-if="phase === 'test'" class="cam-box audio-only">
      <Ic name="mic" :size="120" color="#6f9bff" />
      <view class="ao-t">App 里先录声音，提词照常滚动</view>
      <view class="ao-s">要带画面做出镜评测：用系统相机录好再交</view>
      <button class="btn small" @tap="pickVideo">用系统相机录视频</button>
    </view>

    <!-- 试镜：光线、音量、倒计时、场景预设 -->
    <view v-if="phase === 'test'" class="test">
      <view class="meters">
        <view class="meter"><Ic name="sun" :size="28" :color="lightTone.color" /><text>{{ lightTone.text }}</text></view>
        <view class="meter vol"><Ic name="mic" :size="28" color="#ffffff" /><view class="vol-bar"><view class="vol-in" :style="{ width: `${Math.round(level * 100)}%` }"></view></view></view>
      </view>
      <view class="presets">
        <view v-for="(p, k) in PRESETS" :key="k" class="preset" :class="{ on: prefs.preset === k }" @tap="usePreset(k)"><Ic :name="p.icon" :size="30" :color="prefs.preset === k ? '#ffffff' : '#c9d3e6'" /><text>{{ p.label }}</text></view>
      </view>
      <view class="trial">
        <text class="faint-w">试镜</text>
        <view v-for="s in [10, 20, 30]" :key="s" class="trial-i" :class="{ on: trialLeft > 0 && trialLen === s }" @tap="trial(s)">{{ trialLeft > 0 && trialLen === s ? `${trialLeft}s` : `${s} 秒` }}</view>
        <text class="faint-w">不上传</text>
      </view>
      <button class="btn primary lg block" :disabled="!cues.length" @tap="begin"><Ic name="play" :size="30" color="#ffffff" />开始提词录制</button>
      <view v-if="!cues.length && draft" class="no-cue">这篇还没有口播提示。<text class="link" @tap="makeCues">{{ making ? '生成中…' : '先生成' }}</text></view>
    </view>

    <!-- 提词录制 -->
    <view v-if="phase === 'rec'" class="prompter">
      <view class="p-line"></view>
      <scroll-view scroll-y class="p-scroll" :scroll-top="top" :scroll-with-animation="false" @scroll="onScroll">
        <view class="p-body" :style="{ fontSize: `${size}rpx` }">
          <view v-for="(c, i) in cues" :key="i" :id="`seg${i}`" class="p-seg" :class="{ hi: i === jump }">
            <view v-if="prefs.cues && marks(c).length" class="p-cues"><text v-for="m in marks(c)" :key="m" class="p-cue">{{ m }}</text></view>
            <rich-text :nodes="highlightStress(c.quote, c.stress)" />
          </view>
        </view>
      </scroll-view>
      <view class="ctl">
        <view class="ctl-row">
          <view class="ctl-i" @tap="bump('speed', -5)"><text class="k">慢</text></view>
          <text class="ctl-v">{{ speed }}</text>
          <view class="ctl-i" @tap="bump('speed', 5)"><text class="k">快</text></view>
          <view class="sep"></view>
          <view class="ctl-i" @tap="bump('size', -4)"><text class="k">A-</text></view>
          <view class="ctl-i" @tap="bump('size', 4)"><text class="k">A+</text></view>
          <view class="sep"></view>
          <view class="ctl-i" :class="{ on: prefs.mirror }" @tap="prefs.mirror = !prefs.mirror"><Ic name="mirror" :size="32" color="#ffffff" /></view>
          <view class="ctl-i" :class="{ on: prefs.cues }" @tap="prefs.cues = !prefs.cues"><text class="k">提示</text></view>
          <view class="ctl-i" @tap="restart"><Ic name="refresh" :size="32" color="#ffffff" /></view>
        </view>
        <view class="ctl-main">
          <view class="play" @tap="playing = !playing"><Ic :name="playing ? 'pause' : 'play'" :size="40" color="#ffffff" /></view>
          <button class="btn danger-fill lg" @tap="finish"><view class="sq"></view>结束并上传</button>
        </view>
      </view>
    </view>

    <!-- 提交 -->
    <view v-if="phase === 'submit' || phase === 'queued'" class="sub">
      <view class="sub-card">
        <template v-if="phase === 'submit'">
          <Ic name="clipboard" :size="80" color="#2f6bff" />
          <view class="sub-t">交给任务队列评测？</view>
          <view class="hint">录了 {{ clock }}。转写、总评在后台做，关掉 App 也会接着评，好了会提示。</view>
          <view class="row gap">
            <button class="btn" @tap="retake">重录</button>
            <button class="btn primary grow" :loading="uploading" :disabled="uploading" @tap="submit">交给评测</button>
          </view>
        </template>
        <template v-else>
          <Ic name="check-circle" :size="96" color="#16a34a" />
          <view class="sub-t">{{ savedLocal ? '已存在本机' : '已入队，正在评测' }}</view>
          <view class="hint">{{ savedLocal ? '网络不好，联网后在「口播」页的待上传里补交。' : '可以先去做别的。评测好了会提示，也能在任务中心看进度。' }}</view>
          <view class="row gap">
            <button class="btn" @tap="go('jobs/index')">任务中心</button>
            <button v-if="speakId" class="btn primary grow" @tap="swap('speak/result', { id: speakId })">看评测</button>
            <button v-else class="btn primary grow" @tap="back('speak')">回口播</button>
          </view>
        </template>
      </view>
    </view>
  </view>
</template>

<script setup>
import { computed, nextTick, ref, watch } from 'vue';
import { onLoad, onUnload } from '@dcloudio/uni-app';
import Ic from '../../components/Ic.vue';
import { api, uploadBytes } from '../../lib/api.js';
import { back, confirm, go, swap, toast } from '../../lib/ui.js';
import { highlightStress } from '../../lib/text.js';
import { captureMode, createCapture, keepAwake } from '../../lib/capture.js';
import { keepTake, persistFile } from '../../lib/takes.js';
import { PRESETS, usePrefs } from '../../stores/prefs.js';

const prefs = usePrefs();
const statusH = uni.getSystemInfoSync().statusBarHeight || 20;
const mode = captureMode();
const draft = ref(null);
const phase = ref('test');        // test | rec | submit | queued
const level = ref(0);
const light = ref(null);
const backlit = ref(false);
const trialLen = ref(0);
const trialLeft = ref(0);
const making = ref(false);
const playing = ref(false);
const recording = ref(false);
const elapsed = ref(0);
const top = ref(0);
const jump = ref(-1);
const speed = ref(PRESETS[prefs.preset]?.speed || 45);
const size = ref(PRESETS[prefs.preset]?.size || 32);
const uploading = ref(false);
const savedLocal = ref(false);
const speakId = ref(0);
let id = 0;
let cap = null;
let file = null;
let sampler = 0;
let ticker = 0;
let pos = 0;

const cues = computed(() => draft.value?.cues?.cues || []);
const clock = computed(() => `${String(Math.floor(elapsed.value / 60)).padStart(2, '0')}:${String(elapsed.value % 60).padStart(2, '0')}`);
const lightTone = computed(() => {
  if (light.value == null) return { text: '光线：看画面', color: '#c9d3e6' };
  if (backlit.value) return { text: '逆光', color: '#ffb020' };
  if (light.value < 0.22) return { text: '过暗', color: '#ff6b6b' };
  return { text: '光线 OK', color: '#3ccf7a' };
});
const marks = (c) => [c.emotion && `语气 ${c.emotion}`, c.pause && `停顿 ${c.pause}`, c.expression && `表情 ${c.expression}`, c.gesture && `动作 ${c.gesture}`].filter(Boolean);

onLoad(async (q) => {
  id = Number(q.id);
  jump.value = q.from != null ? Number(q.from) : -1;
  try { draft.value = (await api(`/drafts/${id}`)).draft; } catch (err) { toast(err.message); }
  await nextTick();
  cap = createCapture();
  try {
    // #ifdef H5
    await cap.open(document.getElementById('camHost'));
    // #endif
    // #ifndef H5
    await cap.open();
    // #endif
  } catch {
    toast('打不开摄像头或麦克风，检查一下权限');
  }
  sampler = setInterval(() => {
    const s = cap?.sample?.() || {};
    if (s.level != null) level.value = s.level;
    light.value = s.light;
    backlit.value = s.backlit;
  }, 300);
  if (prefs.keepAwake) keepAwake(true);
});

onUnload(() => {
  clearInterval(sampler);
  clearInterval(ticker);
  cap?.close?.();
  keepAwake(false);
});

function camError() { toast('摄像头打不开：去设置里允许相机权限'); }

function usePreset(k) {
  prefs.preset = k;
  speed.value = PRESETS[k].speed;
  size.value = PRESETS[k].size;
  // #ifdef APP-PLUS || MP
  uni.setScreenBrightness?.({ value: PRESETS[k].bright });
  // #endif
}

let trialTimer = 0;
function trial(s) {
  clearInterval(trialTimer);
  trialLen.value = s;
  trialLeft.value = s;
  trialTimer = setInterval(() => {
    trialLeft.value -= 1;
    if (trialLeft.value <= 0) { clearInterval(trialTimer); toast('试镜结束，可以开始录了'); }
  }, 1000);
}

async function makeCues() {
  if (making.value) return;
  making.value = true;
  try {
    const { cues: got } = await api(`/drafts/${id}/cues`, { method: 'POST', body: {} });
    draft.value = { ...draft.value, cues: got };
  } catch (err) { toast(err.message); } finally { making.value = false; }
}

async function begin() {
  phase.value = 'rec';
  elapsed.value = 0;
  pos = 0;
  top.value = 0;
  await nextTick();
  try { cap.start(); recording.value = true; } catch { toast('开始录制失败'); phase.value = 'test'; return; }
  // 从评测页「点句跳转」进来：先滚到那一句
  if (jump.value >= 0) scrollToSeg(jump.value);
  playing.value = true;
  clearInterval(ticker);
  let tick = 0;
  ticker = setInterval(() => {
    tick += 1;
    if (tick % 20 === 0) elapsed.value += 1;
    if (playing.value) { pos += speed.value / 20 / 2; top.value = pos; }
  }, 50);
}

function scrollToSeg(i) {
  uni.createSelectorQuery().select(`#seg${i}`).boundingClientRect((r) => {
    if (r) { pos = Math.max(0, pos + r.top - 260); top.value = pos; }
  }).exec();
}

function onScroll(e) { if (!playing.value) pos = e.detail.scrollTop; }

function bump(k, d) {
  if (k === 'speed') speed.value = Math.max(10, Math.min(120, speed.value + d));
  else size.value = Math.max(24, Math.min(64, size.value + d));
}

function restart() { pos = 0; top.value = 0.01; nextTick(() => { top.value = 0; }); }

async function finish() {
  playing.value = false;
  clearInterval(ticker);
  file = await cap.stop();
  recording.value = false;
  if (!file) { toast('没录到内容'); phase.value = 'test'; return; }
  phase.value = 'submit';
}

function retake() { file = null; phase.value = 'test'; }

async function submit() {
  if (!file || uploading.value) return;
  uploading.value = true;
  try {
    const data = await uploadBytes(`/drafts/${id}/speaks?async=1`, file.path, { type: file.type, filename: file.filename });
    speakId.value = data.speak?.id || 0;
    savedLocal.value = false;
    phase.value = 'queued';
  } catch (err) {
    if (err.status) { toast(err.message); return; }
    // 断网：先存本机
    keepTake({ draftId: id, title: draft.value?.title || draft.value?.subject || '', path: await persistFile(file.path), type: file.type, filename: file.filename });
    savedLocal.value = true;
    phase.value = 'queued';
  } finally {
    uploading.value = false;
  }
}

/* App：用系统相机录一段带画面的，直接交 */
function pickVideo() {
  uni.chooseVideo({
    sourceType: ['camera'], camera: 'front', maxDuration: 300, compressed: true,
    success: (r) => { file = { path: r.tempFilePath, type: 'video/mp4', filename: 'take.mp4' }; elapsed.value = Math.round(r.duration || 0); phase.value = 'submit'; },
  });
}

async function leave() {
  if (phase.value === 'rec' && !(await confirm({ title: '不录了？', content: '这一遍会丢掉。', ok: '退出', danger: true }))) return;
  if (phase.value === 'rec') { playing.value = false; await cap.stop(); }
  back('speak');
}

watch(() => prefs.keepAwake, (on) => keepAwake(on));
</script>

<style lang="scss" scoped>
.rec { position: fixed; inset: 0; background: #0b0c10; color: #f2f4f7; overflow: hidden; }
.rec-top { position: absolute; left: 0; right: 0; top: 0; z-index: 20; display: flex; align-items: center; padding-left: 24rpx; padding-right: 24rpx; height: calc(var(--status-bar-height) + 96rpx); }
.tb-btn { width: 72rpx; height: 72rpx; border-radius: 50%; background: rgba(255, 255, 255, .12); display: flex; align-items: center; justify-content: center; }
.center { display: flex; justify-content: center; }
.rec-t { font-size: 30rpx; font-weight: 600; }
.rec-clock { display: flex; align-items: center; gap: 12rpx; font-size: 30rpx; font-variant-numeric: tabular-nums; padding: 8rpx 24rpx; border-radius: 30rpx; background: rgba(0, 0, 0, .45); }
.dot { width: 18rpx; height: 18rpx; border-radius: 50%; background: #666; }
.dot.on { background: #ff3d2e; animation: blink 1.1s ease-in-out infinite; }
@keyframes blink { 50% { opacity: .3; } }
.awake { display: flex; align-items: center; gap: 6rpx; font-size: 22rpx; color: #ffd479; padding: 6rpx 14rpx; border-radius: 20rpx; background: rgba(255, 212, 121, .12); }
.cam-box { position: absolute; inset: 0; z-index: 1; background: #111; transition: all .3s; overflow: hidden; }
.cam-box.pip { inset: auto; top: calc(var(--status-bar-height) + 110rpx); right: 24rpx; width: 210rpx; height: 300rpx; border-radius: 20rpx; z-index: 15; box-shadow: 0 10rpx 30rpx rgba(0, 0, 0, .5); }
.cam { width: 100%; height: 100%; }
.mirror .cam { transform: scaleX(-1); }
.frame { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; pointer-events: none; }
.face { width: 420rpx; height: 540rpx; border: 4rpx dashed rgba(255, 255, 255, .7); border-radius: 50%; }
.frame-t { margin-top: 16rpx; font-size: 24rpx; color: rgba(255, 255, 255, .8); }
.audio-only { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16rpx; padding: 0 60rpx; text-align: center; background: radial-gradient(circle at 50% 35%, #1b2740, #0b0c10 70%); }
.ao-t { font-size: 32rpx; font-weight: 600; }
.ao-s { font-size: 24rpx; color: #9aa3b5; margin-bottom: 12rpx; }
.test { position: absolute; left: 0; right: 0; bottom: 0; z-index: 10; padding: 28rpx 32rpx calc(36rpx + env(safe-area-inset-bottom)); background: linear-gradient(transparent, rgba(0, 0, 0, .85) 30%); }
.meters { display: flex; gap: 16rpx; margin-bottom: 20rpx; }
.meter { display: flex; align-items: center; gap: 10rpx; padding: 12rpx 20rpx; border-radius: 30rpx; background: rgba(255, 255, 255, .12); font-size: 24rpx; }
.meter.vol { flex: 1; }
.vol-bar { flex: 1; height: 12rpx; border-radius: 6rpx; background: rgba(255, 255, 255, .2); overflow: hidden; }
.vol-in { height: 100%; background: #3ccf7a; transition: width .2s; }
.presets { display: flex; gap: 16rpx; margin-bottom: 20rpx; }
.preset { flex: 1; display: flex; align-items: center; justify-content: center; gap: 8rpx; padding: 18rpx 0; border-radius: 16rpx; background: rgba(255, 255, 255, .1); font-size: 26rpx; color: #c9d3e6; }
.preset.on { background: #2f6bff; color: #fff; }
.trial { display: flex; align-items: center; gap: 14rpx; margin-bottom: 24rpx; }
.trial-i { padding: 10rpx 22rpx; border-radius: 24rpx; border: 2rpx solid rgba(255, 255, 255, .3); font-size: 24rpx; }
.trial-i.on { background: #fff; color: #0b0c10; }
.faint-w { font-size: 22rpx; color: #8b93a3; }
.no-cue { text-align: center; font-size: 24rpx; color: #c9d3e6; margin-top: 16rpx; }
.link { color: #8fb0ff; }
.prompter { position: absolute; inset: 0; z-index: 5; display: flex; flex-direction: column; }
.p-line { position: absolute; left: 0; right: 0; top: 34%; height: 2rpx; background: rgba(77, 124, 255, .45); z-index: 6; pointer-events: none; }
.p-scroll { flex: 1; min-height: 0; }
.p-body { padding: 36vh 48rpx 60vh; font-weight: 600; line-height: 1.6; color: #f2f4f7; }
.mirror .p-body { transform: scaleX(-1); }
.p-seg { margin-bottom: 1em; }
.p-seg.hi { background: rgba(47, 107, 255, .18); border-radius: 12rpx; }
.p-cues { display: flex; flex-wrap: wrap; gap: 10rpx; margin-bottom: 10rpx; }
.p-cue { font-size: 24rpx; font-weight: 400; color: #a9c1ff; padding: 4rpx 14rpx; border-left: 6rpx solid #2f6bff; background: #131a2b; border-radius: 8rpx; }
.ctl { padding: 20rpx 28rpx calc(24rpx + env(safe-area-inset-bottom)); background: linear-gradient(transparent, #0b0c10 25%); }
.ctl-row { display: flex; align-items: center; gap: 10rpx; margin-bottom: 20rpx; }
.ctl-i { min-width: 64rpx; height: 64rpx; padding: 0 12rpx; border-radius: 16rpx; background: rgba(255, 255, 255, .1); display: flex; align-items: center; justify-content: center; }
.ctl-i.on { background: #2f6bff; }
.ctl-i .k { font-size: 24rpx; }
.ctl-v { min-width: 50rpx; text-align: center; font-size: 26rpx; font-variant-numeric: tabular-nums; }
.sep { width: 2rpx; height: 40rpx; background: rgba(255, 255, 255, .15); margin: 0 6rpx; }
.ctl-main { display: flex; align-items: center; gap: 24rpx; }
.play { width: 104rpx; height: 104rpx; border-radius: 50%; background: #2f6bff; display: flex; align-items: center; justify-content: center; flex: none; }
.btn.danger-fill { flex: 1; background: #f04438; border-color: #f04438; color: #fff; }
.sq { width: 24rpx; height: 24rpx; border-radius: 4rpx; background: #fff; }
.sub { position: absolute; inset: 0; z-index: 30; display: flex; align-items: center; justify-content: center; padding: 48rpx; background: rgba(11, 12, 16, .7); }
.sub-card { width: 100%; background: #fff; color: var(--text); border-radius: 32rpx; padding: 48rpx 40rpx; text-align: center; }
.sub-t { font-size: 34rpx; font-weight: 700; margin: 20rpx 0 12rpx; }
.row.gap { display: flex; gap: 20rpx; margin-top: 36rpx; }
</style>
