<template>
  <div class="cues" id="cuesPane">
    <!-- 口播模式：上面是整体基调和逐段提示，下面是这篇的口播记录 -->
    <!-- 几版口播：原文一版（公众号这类文章是「朗读版」），视频号 / 抖音 / B 站版本各一版 -->
    <div v-if="sp.tracks.length > 1" class="cue-tracks" id="cueTracks" role="tablist">
      <button v-for="t in sp.tracks" :key="t.key" type="button" role="tab" :data-track="t.key || 'main'"
        :class="{ on: sp.version === t.key }" :aria-selected="sp.version === t.key" @click="pickTrack(t)">
        <b>{{ t.label }}</b><span>{{ t.cues ? `${t.cues.cues.length} 段` : (t.exists ? '还没标口播' : '还没生成') }}</span>
      </button>
    </div>
    <p v-if="sp.track" class="hint cue-track-hint">{{ sp.track.hint }}</p>
    <div class="cues-head">
      <div class="cues-overall" id="cuesOverall">
        <template v-if="c && editingOverall">
          <label class="cue-field"><b>整体基调</b><input v-model="ov.tone" maxlength="120" /></label>
          <label class="cue-field"><b>语速节奏</b><input v-model="ov.pace" maxlength="120" /></label>
          <label class="cue-field"><b>出镜提醒</b><input v-model="ov.note" maxlength="160" /></label>
          <div class="cue-edit-acts">
            <button type="button" class="btn primary small" id="overallSave" @click="saveOverall">保存</button>
            <button type="button" class="btn ghost small" @click="editingOverall = false">取消</button>
          </div>
        </template>
        <template v-else-if="c">
          <div v-for="[k, val] in overall" :key="k" class="row"><b>{{ k }}</b><span>{{ val }}</span></div>
          <button type="button" class="link-btn" id="overallEdit" @click="startOverall">改整体基调</button>
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
        <BusyBtn class="btn primary small" id="cuesRunBtn" :busy="sp.cuesRunning" @click="regen">{{ c ? '重新生成' : (sp.version && !sp.track?.exists ? `生成${sp.track?.label || '视频号口播版'}` : '生成口播提示') }}</BusyBtn>
      </div>
    </div>
    <div class="cue-list" id="cueList">
      <template v-if="sp.cuesRunning"><div v-for="i in 3" :key="i" class="idea-skeleton"></div></template>
      <div v-else-if="sp.cuesError" class="ideas-state error">{{ sp.cuesError }}</div>
      <template v-else-if="c">
        <p class="hint cue-edit-tip">每一段都能改：点「改」可以改要念的词，以及语气、重读、停顿、表情、动作。改词会同步改稿子。<template v-if="hasScene">灰底的是稿子里的【画面】【字幕】这类拍摄标注，不念，拍的时候看。</template></p>
        <div v-for="(x, i) in c.cues" :key="i" class="cue" :class="{ editing: editing === i }" :data-cue="i">
          <div v-for="(y, j) in sp.scenes.before[i]" :key="`s${j}`" class="cue-scene" :data-scene="i"><b>{{ y.tag }}</b>{{ y.text }}</div>
          <template v-if="editing === i">
            <label class="cue-field wide"><b>念的词</b><textarea v-model="form.quote" rows="3" class="cue-quote-input"></textarea></label>
            <label class="cue-field"><b>语气</b><input v-model="form.emotion" maxlength="40" placeholder="例：带点自嘲" /></label>
            <label class="cue-field"><b>重读</b><input v-model="form.stress" maxlength="80" placeholder="要重读的词，用顿号隔开，必须是这段里的词" /></label>
            <label class="cue-field"><b>停顿</b><input v-model="form.pause" maxlength="60" placeholder="例：说完「三小时」停一拍" /></label>
            <label class="cue-field"><b>表情</b><input v-model="form.expression" maxlength="60" placeholder="不需要就留空" /></label>
            <label class="cue-field"><b>动作</b><input v-model="form.gesture" maxlength="60" placeholder="不需要就留空" /></label>
            <div class="cue-edit-acts">
              <BusyBtn class="btn primary small" :data-cue-save="i" :busy="sp.cueSaving" @click="save(i)">保存</BusyBtn>
              <button type="button" class="btn ghost small" @click="editing = -1">取消</button>
            </div>
          </template>
          <template v-else>
            <div class="cue-text" v-html="highlightStress(x.quote, x.stress)"></div>
            <div class="cue-marks">
              <span v-for="[cls, k, val] in marks(x)" :key="k" class="cue-mark" :class="cls"><b>{{ k }}</b>{{ val }}</span>
              <button type="button" class="link-btn cue-edit-btn" :data-cue-edit="i" @click="startEdit(i, x)">改</button>
            </div>
          </template>
        </div>
        <div v-for="(y, j) in sp.scenes.tail" :key="`t${j}`" class="cue-scene tail" data-scene="tail"><b>{{ y.tag }}</b>{{ y.text }}</div>
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
import { computed, reactive, ref, watch } from 'vue';
import { ask } from '../lib/feedback.js';
import BusyBtn from './common/BusyBtn.vue';
import SpeakReview from './SpeakReview.vue';
import { useStudioStore } from '../stores/studio.js';
import { useSpeakStore } from '../stores/speak.js';
import { usePrompterStore } from '../stores/prompter.js';
import { useVersionsStore } from '../stores/versions.js';
import { highlightStress, stamp } from '../lib/text.js';
import { toast } from '../lib/feedback.js';

const s = useStudioStore();
const sp = useSpeakStore();
const ver = useVersionsStore();
const hasScene = computed(() => sp.scenes.tail.length > 0 || sp.scenes.before.some((a) => a.length));
/* 切口播版本：上面的版本栏也跟着切过去（还没生成的视频号版除外），正文和口播看的是同一版 */
function pickTrack(t) {
  sp.version = t.key;
  if (ver.tabs.length && (!t.key || t.exists)) ver.switchTo(t.key);
}
const prompter = usePrompterStore();
const file = ref(null);

const c = computed(() => sp.cues);   // 当前选中这一版的口播提示
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

/* 改某一段 */
const editing = ref(-1);
const form = reactive({ quote: '', emotion: '', stress: '', pause: '', expression: '', gesture: '' });
function startEdit(i, x) {
  Object.assign(form, { quote: x.quote, emotion: x.emotion, stress: (x.stress || []).join('、'), pause: x.pause, expression: x.expression, gesture: x.gesture });
  editing.value = i;
}
async function save(i) {
  if (await sp.saveCue(i, { ...form })) editing.value = -1;
}
watch(() => [sp.version, s.draft?.id], () => { editing.value = -1; editingOverall.value = false; });

/* 改整体基调 */
const editingOverall = ref(false);
const ov = reactive({ tone: '', pace: '', note: '' });
function startOverall() {
  const o = c.value?.overall || {};
  Object.assign(ov, { tone: o.tone || '', pace: o.pace || '', note: o.note || '' });
  editingOverall.value = true;
}
async function saveOverall() {
  if (await sp.saveOverall({ ...ov })) editingOverall.value = false;
}

/* 重新生成会把手改的提示冲掉：改过的先问一句 */
async function regen() {
  if (c.value?.edited && !await ask.confirm({ title: '重新生成口播提示？', body: '你手动改过的语气、重读这些会被新的提示替换（改过的词留在稿子里）。', ok: '重新生成' })) return;
  await sp.runCues();
}

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
