<template>
<div class="prompter" id="prompter" :class="{ hidden: !p.show, 'no-cues': !p.cfg.cues, mirrored: p.cfg.mirror }">
  <div class="prompter-bar">
    <button class="pbtn primary" id="pPlay" title="空格" @click="toggle"><Icon :name="playing ? 'pause' : 'play'" :size="14" />{{ playing ? '暂停' : '开始' }}<small>（空格）</small></button>
    <button class="pbtn" id="pRec" :class="{ rec: recording }" title="录这一遍，停下来就去总评" @click="toggleRec"><i class="rec-ball"></i>{{ recording ? '停止' : '录' }}<small>（录完去总评）</small></button>
    <span class="psep"></span>
    <div class="pgroup">
      <span class="plabel">滚动速度</span>
      <div class="pctl">
        <button class="pbtn sm" data-speed="-1" title="[" @click="bump('speed', -5)">−</button>
        <b id="pSpeedVal">{{ p.cfg.speed }}</b>
        <button class="pbtn sm" data-speed="1" title="]" @click="bump('speed', 5)">＋</button>
      </div>
    </div>
    <div class="pgroup">
      <span class="plabel">字号</span>
      <div class="pctl">
        <button class="pbtn sm" data-size="-1" title="减号" @click="bump('size', -4)">A−</button>
        <b id="pSizeVal">{{ p.cfg.size }}</b>
        <button class="pbtn sm" data-size="1" title="加号" @click="bump('size', 4)">A+</button>
      </div>
    </div>
    <div class="pgroup">
      <span class="plabel">提示</span>
      <button class="pswitch" id="pCues" :class="{ on: p.cfg.cues }" title="C" :aria-pressed="String(p.cfg.cues)" @click="flip('cues')"><i></i><span class="sr">{{ p.cfg.cues ? '提示 开' : '提示 关' }}</span></button>
    </div>
    <span class="psep"></span>
    <button class="pbtn" id="pMirror" :class="{ on: p.cfg.mirror }" title="M" @click="flip('mirror')"><Icon name="mirror" :size="14" />镜像</button>
    <button class="pbtn" id="pRestart" title="R" @click="restart"><Icon name="refresh" :size="14" />重来</button>
    <span class="psep"></span>
    <div class="pgroup pgrow">
      <span class="plabel">进度 <em id="pProgress">{{ progress }}%</em></span>
      <div class="pbar"><i :style="{ width: `${progress}%` }"></i></div>
    </div>
    <button class="pbtn" id="pClose" title="Esc" @click="close"><Icon name="x" :size="14" />退出</button>
  </div>

  <!-- 点画面本身也能播放 / 暂停，录制时不用去够按钮；滚轮也能挪 -->
  <div class="prompter-stage" id="pStage" ref="stage" @click="toggle" @wheel.prevent="nudge($event.deltaY)">
    <div class="prompter-line"></div>
    <div class="prompter-scroll" id="pScroll">
      <!-- 滚动位移和镜像必须写在同一个 transform 里：行内 transform 会整个覆盖 CSS 里的规则，分开写镜像就没了 -->
      <div class="prompter-body" id="pBody" ref="body" :style="{ fontSize: `${p.cfg.size}px`, transform: `translateY(${-offset}px)${p.cfg.mirror ? ' scaleX(-1)' : ''}` }">
        <div v-for="(c, i) in cues" :key="i" class="pseg">
          <div class="pseg-text" v-html="highlightStress(c.quote, c.stress)"></div>
          <div v-if="segMarks(c).length" class="pseg-cues"><span v-for="[k, val] in segMarks(c)" :key="k"><b>{{ k }}</b> {{ val }}</span></div>
        </div>
      </div>
    </div>
  </div>

  <div class="prompter-help">
    空格 播放/暂停　·　● 录这一遍，再按一次停止并评分　·　<b>↑↓ 挪动画面</b>（滚轮同）　·　PgUp/PgDn 翻页　·　[ ] 速度　·　+− 字号　·　C 提示　·　M 镜像　·　R 重来　·　Esc 退出
  </div>
</div>
</template>

<script setup>
/* 提词器的画面：按速度匀速往上滚，上下键随时挪（念快了往回一点，念慢了往前赶一点），录完直接去总评 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import Icon from './common/Icon.vue';
import { usePrompterStore } from '../stores/prompter.js';
import { useStudioStore } from '../stores/studio.js';
import { useSpeakStore } from '../stores/speak.js';
import { highlightStress } from '../lib/text.js';
import { toast } from '../lib/feedback.js';

const p = usePrompterStore();
const s = useStudioStore();
const stage = ref(null);
const body = ref(null);

const cues = computed(() => s.draft?.cues?.cues || []);
const segMarks = (c) => [
  c.emotion ? ['语气', c.emotion] : null,
  c.pause ? ['停顿', c.pause] : null,
  c.expression ? ['表情', c.expression] : null,
  c.gesture ? ['动作', c.gesture] : null,
].filter(Boolean);

const offset = ref(0);
const max = ref(0);
const playing = ref(false);
const progress = computed(() => (max.value ? Math.min(100, Math.round((offset.value / max.value) * 100)) : 0));
let raf = 0;
let last = 0;

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

/* 滚到最后一段能停在阅读线上就够了，不用把整块留白都滚完 */
function measure() {
  const lastSeg = body.value?.lastElementChild;
  max.value = lastSeg ? Math.max(0, lastSeg.offsetTop + lastSeg.offsetHeight - stage.value.clientHeight * 0.32) : 0;
}

function nudge(delta) {
  offset.value = clamp(offset.value + delta, 0, max.value);
}

function play() {
  if (playing.value) return;
  playing.value = true;
  last = performance.now();
  const step = (now) => {
    if (!playing.value) return;
    const dt = (now - last) / 1000;
    last = now;
    offset.value = Math.min(max.value, offset.value + p.cfg.speed * dt);
    if (offset.value >= max.value) { pause(); return; }
    raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);
}

function pause() {
  playing.value = false;
  cancelAnimationFrame(raf);
}

const toggle = () => (playing.value ? pause() : play());

function restart() {
  pause();
  offset.value = 0;
}

function bump(key, delta) {
  const [lo, hi] = key === 'speed' ? [10, 200] : [20, 96];
  p.cfg[key] = clamp(p.cfg[key] + delta, lo, hi);
  p.saveCfg();
  if (key === 'size') nextTick(measure);
}

function flip(key) {
  p.cfg[key] = !p.cfg[key];
  p.saveCfg();
  nextTick(measure);
}

/* 录制时别让屏幕睡过去 */
let wakeLock = null;
async function requestWakeLock() {
  try { wakeLock = await navigator.wakeLock?.request('screen'); } catch { /* 不支持就算了 */ }
}
function releaseWakeLock() {
  try { wakeLock?.release(); } catch { /* 忽略 */ }
  wakeLock = null;
}

watch(() => p.show, async (open) => {
  if (!open) return;
  restart();
  requestWakeLock();
  await nextTick();
  setTimeout(measure, 60);      // 布局稳定后再量高度
});

function closeNow() {
  pause();
  p.show = false;
  releaseWakeLock();
}

/* 正在录就先停（停下来会去总评），没在录才直接退出 */
function close() {
  if (recorder?.state === 'recording') { recorder.stop(); return; }
  closeNow();
}

/* ---------- 在提词器里直接录：停下来走口播上传，结果进这篇的口播记录 ---------- */
const recording = ref(false);
let recorder = null;
let chunks = [];
let recTimer = 0;
const REC_MS = 8 * 60 * 1000;

function audioMime() {
  if (typeof MediaRecorder === 'undefined') return '';
  if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) return 'audio/webm;codecs=opus';
  if (MediaRecorder.isTypeSupported('audio/webm')) return 'audio/webm';
  return '';
}

async function toggleRec() {
  if (!cues.value.length) { toast('先生成口播提示'); return; }
  if (typeof MediaRecorder === 'undefined') { toast('这个浏览器不能在页面里录音'); return; }
  if (recorder?.state === 'recording') { recorder.stop(); return; }
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    toast('没有拿到麦克风');
    return;
  }
  const mime = audioMime();
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  chunks = [];
  rec.ondataavailable = (ev) => { if (ev.data?.size) chunks.push(ev.data); };
  rec.onstop = () => {
    stream.getTracks().forEach((t) => t.stop());
    clearTimeout(recTimer);
    recorder = null;
    recording.value = false;
    const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
    chunks = [];
    closeNow();
    if (blob.size > 0) { toast('正在评估这一遍'); useSpeakStore().submitTake(blob, 'prompter.webm'); } else toast('没有录到声音');
  };
  recorder = rec;
  rec.start();
  recording.value = true;
  recTimer = setTimeout(() => {
    if (recorder?.state === 'recording') { toast('录音已到 8 分钟，先停下来评估'); recorder.stop(); }
  }, REC_MS);
}

/* ---------- 键盘 ---------- */
const KEYS = [' ', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', '[', ']', '【', '】', '+', '=', '-', 'r', 'R', 'm', 'M', 'c', 'C', 'Escape'];

function onKey(e) {
  if (!p.show || !KEYS.includes(e.key)) return;
  e.preventDefault();
  e.stopPropagation();
  const line = Math.round(p.cfg.size * 1.55);     // 一行的高度：.pseg-text 的 line-height 是 1.55
  const page = Math.round(stage.value.clientHeight * 0.8);
  switch (e.key) {
    case 'ArrowUp': nudge(-line); break;
    case 'ArrowDown': nudge(line); break;
    case 'PageUp': nudge(-page); break;
    case 'PageDown': nudge(page); break;
    case 'Home': nudge(-max.value); break;
    case 'End': nudge(max.value); break;
    // 速度放在中括号上，腾出上下键
    case '[': case '【': bump('speed', -5); break;
    case ']': case '】': bump('speed', 5); break;
    case ' ': toggle(); break;
    case '+': case '=': bump('size', 4); break;
    case '-': bump('size', -4); break;
    case 'r': case 'R': restart(); break;
    case 'm': case 'M': flip('mirror'); break;
    case 'c': case 'C': flip('cues'); break;
    case 'Escape': close(); break;
    default: break;
  }
}

const onResize = () => { if (p.show) measure(); };

onMounted(() => {
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('resize', onResize);
});
onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKey, true);
  window.removeEventListener('resize', onResize);
  pause();
});
</script>
