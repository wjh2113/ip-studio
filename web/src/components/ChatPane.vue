<template>
  <div class="chat-pane" id="chatPane">
    <!-- 成稿右栏的 AI 对话：问意见，或说要怎么改（打字或用嘴说）。局部改动先列在这里，点「应用」才写进左边的正文；
         整篇重写先问一句「开始吗」，点了才动手 -->
    <div ref="log" class="chat-log" id="chatLog">
      <p v-if="c.loading && !c.messages.length" class="wp-text">正在取对话记录…</p>
      <div v-else-if="!c.messages.length" class="chat-empty">
        <p class="wp-text">跟 AI 聊这篇稿子：问它意见，或者直接说要怎么改。{{ verNote }}小改会列出每处改动，点「应用」才写进左边的正文，能撤销；整篇重写会先问你一句再动手。</p>
        <p class="wp-text">想针对某一段：选中它 → 工具条「改写」→「问 AI」，会带着这段过来。点输入框旁的话筒可以用嘴说。</p>
        <div class="chat-suggest">
          <button v-for="t in CHAT_SUGGESTS" :key="t" type="button" class="chat-sug" :disabled="!canSend" @click="c.send(t)">{{ t }}</button>
        </div>
      </div>

      <div v-for="(m, mi) in c.messages" :key="m.id || `t${mi}`" class="chat-msg" :class="[m.role, { flash: m.id && c.flash === m.id }]" :data-mid="m.id || null">
        <template v-if="m.role === 'user'">
          <blockquote v-if="m.quote" class="chat-quote">{{ clip(m.quote, 90) }}</blockquote>
          <div class="chat-bubble"><span v-if="m.skill" class="chat-skill-tag"><Icon name="bolt" :size="11" />{{ m.skill.name }}</span>{{ m.content }}</div>
          <button v-if="m.id && !m.skill && m.content.length >= 4 && !m.content.startsWith('换个改法') && !m.content.startsWith('检查提示')" type="button"
            class="link-btn chat-save-skill" data-act="save-skill" title="做成技能，以后在划词菜单和对话里一点就能用" @click="sk.openPage(null, { instruction: m.content })">存成技能</button>
        </template>
        <!-- 工具条「检查」「扫 AI 味」的结果：一张卡片 -->
        <template v-else-if="m.card">
          <div v-if="m.pending" class="chat-thinking"><span class="chat-dots"><i></i><i></i><i></i></span>{{ m.card === 'review' ? '正在检查全文…' : '正在扫 AI 味…' }}</div>
          <div v-else-if="m.error" class="chat-err">{{ m.card === 'review' ? '检查' : 'AI 味扫描' }}没做成：{{ m.error }} <button type="button" class="mini" @click="retryCard(m)">重试</button></div>
          <ReviewBox v-else-if="m.card === 'review'" :m="m" :latest="m.id === latestId('review')" />
          <ToneBox v-else :m="m" :latest="m.id === latestId('tone')" />
        </template>
        <template v-else>
          <div v-if="m.pending" class="chat-thinking"><span class="chat-dots"><i></i><i></i><i></i></span>正在想…</div>
          <template v-else>
            <!-- 回话是 Markdown；断线时已出的字也留着，下面再跟错误条 -->
            <div v-if="m.content" class="chat-reply" :class="{ typing: m.streaming }" v-html="markdown(m.content)"></div>
            <p v-if="m.model?.name && !m.error" class="chat-by">{{ m.model.auto ? '自动 · ' : '' }}{{ m.model.name }}</p>
            <div v-if="m.packing" class="chat-thinking chat-after"><span class="chat-dots"><i></i><i></i><i></i></span>正在整理改动…</div>
            <div v-else-if="m.streaming" class="chat-thinking chat-after"><span class="chat-dots"><i></i><i></i><i></i></span></div>
            <div v-if="m.error" class="chat-err">{{ m.error }} <button type="button" class="mini" @click="c.retry(m)">重试</button></div>
            <p v-if="m.stopped" class="chat-stopped" data-stopped><Icon name="stop" :size="11" />已停止{{ m.content ? '' : '，还没写出字' }}</p>

            <!-- 整篇重写：先确认再动手 -->
            <div v-if="!m.error && m.rewrite" class="chat-changes chat-rewrite" data-kind="rewrite">
              <div class="chat-changes-head">
                <Icon name="refresh" :size="13" /><span>整篇重写</span>
                <span class="grow"></span>
                <span v-if="m.started" class="chat-done"><Icon name="check" :size="13" />已重写</span>
                <template v-else>
                  <button type="button" class="mini ghost" data-act="redo" :disabled="c.busy || !canSend || m.running" title="换一种整理思路" @click="c.redo(m)">换个说法</button>
                  <BusyBtn type="button" class="mini primary" data-act="rewrite" :busy="m.running" busy-text="重写中"
                    :disabled="s.streaming || c.busy" @click="c.startRewrite(m)">开始重写</BusyBtn>
                </template>
              </div>
              <ol class="chat-notes"><li v-for="(n, i) in notes(m.rewrite)" :key="i">{{ n }}</li></ol>
              <p class="chat-tip">{{ m.started ? '左边正文上方有逐段对照，哪段不满意可以单独退回；原稿留在「版本对照」里，Ctrl+Z 也能退回。' : '会按这几条把整篇重写一遍（按整篇计点）。不想整篇动，直接说「只改开头」这类话。' }}</p>
            </div>

            <!-- 局部改动 -->
            <div v-else-if="!m.error && m.edits.length" class="chat-changes">
              <div class="chat-changes-head">
                <Icon name="pen" :size="13" />
                <span>{{ m.edits.length }} 处改动</span>
                <span class="grow"></span>
                <button v-if="!m.steps.length" type="button" class="mini ghost" data-act="redo" :disabled="c.busy || !canSend" title="按同样的要求再出一版，和这版不一样" @click="c.redo(m)">换个改法</button>
                <button v-if="m.steps.length" type="button" class="mini" data-act="undo" @click="c.undo(m)">撤销</button>
                <button v-if="!c.allDone(m)" type="button" class="mini primary" data-act="apply" :disabled="s.streaming" @click="c.apply(m)">{{ m.edits.length > 1 ? '全部应用' : '应用' }}</button>
                <span v-else class="chat-done"><Icon name="check" :size="13" />已应用</span>
              </div>
              <div v-for="(e, i) in m.edits" :key="i" class="chat-edit" :class="{ done: m.done[i] }">
                <del v-if="e.find">{{ clip(e.find, 140) }}</del>
                <ins v-if="e.replace">{{ clip(e.replace, 300) }}</ins>
                <span v-else class="chat-del-note">（删掉这段）</span>
                <div class="chat-edit-acts">
                  <button type="button" class="link-btn" @click="c.locate(m, i)">在正文里看</button>
                  <button v-if="!m.done[i] && m.edits.length > 1" type="button" class="link-btn" data-act="apply-one" @click="c.apply(m, i)">只应用这处</button>
                  <button v-if="!m.done[i] && c.canInsert(e)" type="button" class="link-btn" data-act="insert" title="原文留着，新写的这段插在它后面" @click="c.apply(m, i, { after: true })">插在原文后面</button>
                </div>
              </div>
            </div>
            <p v-if="!m.error && m.skipped.length" class="chat-skip">另有 {{ m.skipped.length }} 处没对上正文，已略过。</p>
          </template>
        </template>
      </div>
    </div>

    <form class="chat-input" id="chatForm" @submit.prevent="submit">
      <div v-if="c.quote" class="chat-quote-chip" id="chatQuote">
        <Icon name="link" :size="12" /><span>引用：{{ clip(c.quote, 60) }}</span>
        <button type="button" title="不带这段" aria-label="去掉引用" @click="c.quote = ''"><Icon name="x" :size="12" /></button>
      </div>
      <div class="chat-box">
        <textarea id="chatInput" ref="input" v-model="c.input" rows="3" maxlength="2000"
          :placeholder="placeholder" :disabled="!canSend" @keydown="onKey"></textarea>
        <button type="button" class="chat-mic" id="chatMicBtn" :class="{ recording: c.mic.recording }"
          :disabled="!canSend || c.mic.recognizing" :title="c.mic.recording ? '说完了，点一下结束' : '用嘴说：说完转成文字放进输入框，看过再发'"
          :aria-label="c.mic.recording ? '结束录音' : '语音输入'" @click="c.toggleMic()"><Icon name="mic" :size="15" /></button>
      </div>
      <p v-if="settings.modelsGone" class="chat-model-gone" id="chatModelGone">
        <Icon name="info" :size="13" />你选的模型已停用，请在左下角重新选择
      </p>
      <div class="chat-input-foot">
        <!-- 左下角选模型（像 Notion）：自动 = 按功能分档自动选路；指定了就只用那一个，调不通会直接说，不偷偷换 -->
        <ModelPicker v-if="settings.canPick" :disabled="c.busy" />
        <span v-else class="chat-model static" title="当前接入方式只支持自动选模型"><Icon name="sparkles" :size="12" />自动</span>
        <SkillPicker :disabled="c.busy || !canSend" />
        <span v-if="c.mic.recording || c.mic.recognizing" class="hint">{{ c.mic.recording ? '在听…说完点话筒' : '转文字中…' }}</span>
        <span class="grow"></span>
        <!-- AI 回答时「发送」变成方块「停止」：点了立刻断开，写出来的留着 -->
        <button v-if="c.busy" type="button" class="btn small chat-stop" id="chatStopBtn" title="停止这次回答" @click="c.stop()"><Icon name="stop" :size="12" />停止</button>
        <button v-else type="submit" class="btn primary small" id="chatSendBtn" :disabled="!c.input.trim() || !canSend">发送</button>
      </div>
      <div class="chat-meta">
        <button type="button" class="link-btn" id="chatKeepLink" title="在个人设置里改对话保存天数和模型能力" @click="settings.show()">个人设置</button>
        <span class="grow"></span>
        <button v-if="c.messages.length" type="button" class="link-btn" id="chatClearBtn" :disabled="c.busy" @click="clearAll">清空这篇的对话</button>
      </div>
    </form>
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import Icon from './common/Icon.vue';
import BusyBtn from './common/BusyBtn.vue';
import ModelPicker from './ModelPicker.vue';
import ReviewBox from './ReviewBox.vue';
import ToneBox from './ToneBox.vue';
import { useReviewStore } from '../stores/review.js';
import SkillPicker from './SkillPicker.vue';
import { useSkillsStore } from '../stores/skills.js';
import { CHAT_SUGGESTS, useChatStore } from '../stores/chat.js';
import { useStudioStore } from '../stores/studio.js';
import { useEditorStore } from '../stores/editor.js';
import { useVersionsStore } from '../stores/versions.js';
import { useSettingsStore } from '../stores/settings.js';
import { ask } from '../lib/feedback.js';
import { markdown } from '../lib/text.js';

const c = useChatStore();
const s = useStudioStore();
const ed = useEditorStore();
const v = useVersionsStore();
const settings = useSettingsStore();
const sk = useSkillsStore();
const review = useReviewStore();

/* 最新那张检查 / AI 味卡片：带 id，测试和「再检查一遍」认它 */
const latestId = (card) => [...c.messages].reverse().find((x) => x.card === card && x.id)?.id || 0;

/* 卡片没做成：拿掉这张，再查一次 */
function retryCard(m) {
  const i = c.messages.indexOf(m);
  if (i >= 0) c.messages.splice(i, 1);
  if (m.card === 'review') review.run({ force: true });
  else review.scanTone();
}
const log = ref(null);
const input = ref(null);

const clip = (t, n) => { const x = String(t || ''); return x.length > n ? `${x.slice(0, n)}…` : x; };
const notes = (t) => String(t || '').split('\n').map((x) => x.replace(/^\s*(\d+[.、)]|[-*·])\s*/, '').trim()).filter(Boolean);
const canSend = computed(() => Boolean(s.draft?.id && ed.text.trim() && !s.streaming && !settings.modelsGone));
const verNote = computed(() => (v.current ? `现在对着「${v.label}」版聊，改的也是这一版。` : ''));
const placeholder = computed(() => {
  if (settings.modelsGone) return '你选的模型已停用，先在左下角重新选一个';
  if (!canSend.value) return s.streaming ? '正在生成，等写完再聊' : '有了正文才能聊';
  return '问 AI，或说要怎么改（Enter 发送，Shift+Enter 换行）';
});

function submit() {
  if (!c.input.trim() || c.busy) return;
  c.send();
}

function onKey(e) {
  if (e.key !== 'Enter' || e.shiftKey || e.isComposing || e.keyCode === 229) return;
  e.preventDefault();
  submit();
}

async function clearAll() {
  if (!(await ask.confirm({ title: '清空这篇的对话？', body: '只清这篇（这一版）的对话记录，正文不动。清了找不回。', ok: '清空', danger: true }))) return;
  c.clear();
}

/* 有新消息或回话到了：滚到底 */
const scrollEnd = () => nextTick(() => { if (log.value) log.value.scrollTop = log.value.scrollHeight; });
watch(() => [c.messages.length, c.messages[c.messages.length - 1]?.pending, c.messages[c.messages.length - 1]?.content?.length], scrollEnd);
watch(() => c.focusTick, () => nextTick(() => input.value?.focus()));
/* 「检查」时正文没改过：滚到上次那张卡片，闪一下 */
watch(() => c.flash, (id) => {
  if (!id) return;
  nextTick(() => log.value?.querySelector(`[data-mid="${id}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' }));
});
/* 换了稿子或版本：取那一串的记录；引用的那段属于上一篇，不带过去 */
watch(() => s.draft?.id, () => { c.quote = ''; });
watch(() => [s.draft?.id, ed.editVer], () => { void c.load().then(scrollEnd); });
onMounted(() => {
  void c.load().then(scrollEnd);
  void settings.loadModels();      // 左下角的模型列表；1 分钟内不重复取
  if (c.focusTick) input.value?.focus();
});
onBeforeUnmount(() => c.stopMic());
</script>
