<template>
  <div class="cues" id="cuesPane">
    <!-- 口播模式：上面是整体基调和逐段提示，下面是这篇的口播记录 -->
    <div class="cues-head">
      <div class="cues-overall" id="cuesOverall">
        <template v-if="c">
          <div v-for="[k, val] in overall" :key="k" class="row"><b>{{ k }}</b><span>{{ val }}</span></div>
          <div v-if="c.trimmed" class="cues-note">改稿后有 {{ c.trimmed }} 条对不上，已拿掉。还在的下一遍仍按这套提示评。</div>
          <div v-if="c.coverage < 60" class="cues-note">只覆盖了正文约 {{ c.coverage }}%——标题、标签这类不念的内容会跳过</div>
        </template>
      </div>
      <div class="toolbar">
        <div class="tb-group">
          <span class="tb-label">自己念</span>
          <button v-if="c" class="btn ghost small" id="prompterBtn" @click="prompter.open()">提词器</button>
          <button v-if="c" class="btn ghost small" id="copyCuesBtn" @click="sp.copyCues()">复制口播稿</button>
        </div>
        <span class="grow"></span>
        <BusyBtn class="btn primary small" id="cuesRunBtn" :busy="sp.cuesRunning" @click="sp.runCues()">{{ c ? '重新生成' : '生成口播提示' }}</BusyBtn>
      </div>
    </div>
    <div class="cue-list" id="cueList">
      <template v-if="sp.cuesRunning"><div v-for="i in 3" :key="i" class="idea-skeleton"></div></template>
      <div v-else-if="sp.cuesError" class="ideas-state error">{{ sp.cuesError }}</div>
      <template v-else-if="c">
        <div v-for="(x, i) in c.cues" :key="i" class="cue" :data-cue="i">
          <div class="cue-text" v-html="highlightStress(x.quote, x.stress)"></div>
          <div class="cue-marks"><span v-for="[cls, k, val] in marks(x)" :key="k" class="cue-mark" :class="cls"><b>{{ k }}</b>{{ val }}</span></div>
        </div>
      </template>
    </div>
    <div class="speak-box" id="speakBox">
      <div class="speak-head">
        <div>
          <b>口播记录</b>
          <span class="hint" id="speakHint">上传后先做文字总评。语音测评、视频测评要点开这一遍再做。记录只有你删除才会去掉。</span>
        </div>
        <button class="btn primary small" id="speakUploadBtn" :disabled="!c?.cues?.length || sp.uploading" @click="pick">{{ sp.uploading ? '上传中…' : '上传音视频' }}</button>
        <input type="file" id="speakFile" ref="file" hidden accept="audio/*,video/mp4,video/webm,.mp3,.wav,.m4a,.webm,.mp4,.ogg" @change="picked" />
      </div>
      <div id="speakList">
        <p v-if="!sp.list.length" class="hint">还没有口播记录。</p>
        <div v-for="x in sp.list" :key="x.id" class="speak-row" :class="{ open: s.focusSpeakId === x.id }" :data-speak-row="x.id">
          <button type="button" class="speak-sum" :data-speak-open="x.id" @click="sp.toggleOpen(x.id)">
            <b>{{ x.score == null ? '—' : x.score }}</b>
            <span>{{ stamp(x.createdAt) }}</span>
            <span class="grow">{{ x.status === 'running' ? '正在转写和总评…' : (x.next || x.error || (x.status === 'failed' ? '评估失败' : '')) }}</span>
            <em v-if="x.draftGone || x.stale">{{ x.draftGone ? '稿子已不在' : '当时的稿子' }}</em>
          </button>
          <button type="button" class="mini del" :data-speak-del="x.id" title="删除这遍" @click="sp.remove(x.id)">删除</button>
          <div v-if="s.focusSpeakId === x.id" class="speak-detail"><SpeakReview :speak="x" /></div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue';
import BusyBtn from './common/BusyBtn.vue';
import SpeakReview from './SpeakReview.vue';
import { useStudioStore } from '../stores/studio.js';
import { useSpeakStore } from '../stores/speak.js';
import { usePrompterStore } from '../stores/prompter.js';
import { highlightStress, stamp } from '../lib/text.js';
import { toast } from '../lib/feedback.js';

const s = useStudioStore();
const sp = useSpeakStore();
const prompter = usePrompterStore();
const file = ref(null);

const c = computed(() => sp.cues);
const overall = computed(() => {
  const o = c.value?.overall || {};
  return [['整体基调', o.tone], ['语速节奏', o.pace], ['出镜提醒', o.note]].filter(([, val]) => val);
});

const marks = (x) => [
  x.emotion ? ['emotion', '语气', x.emotion] : null,
  x.stress?.length ? ['stress', '重读', x.stress.join('、')] : null,
  x.pause ? ['pause', '停顿', x.pause] : null,
  x.expression ? ['exp', '表情', x.expression] : null,
  x.gesture ? ['ges', '动作', x.gesture] : null,
].filter(Boolean);

function pick() {
  if (!c.value?.cues?.length) { toast('先生成口播提示'); return; }
  file.value.click();
}

async function picked() {
  const f = file.value.files?.[0];
  file.value.value = '';
  if (f) await sp.submitTake(f, f.name || 'take.webm');
}
</script>
