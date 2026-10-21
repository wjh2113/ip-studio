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

      <div v-for="(m, mi) in c.messages" :key="m.id || `t${mi}`" class="chat-msg" :class="m.role">
        <template v-if="m.role === 'user'">
          <blockquote v-if="m.quote" class="chat-quote">{{ clip(m.quote, 90) }}</blockquote>
          <div class="chat-bubble">{{ m.content }}</div>
        </template>
        <template v-else>
          <div v-if="m.pending" class="chat-thinking"><span class="chat-dots"><i></i><i></i><i></i></span>正在看稿子…</div>
          <div v-else-if="m.error" class="chat-err">{{ m.error }} <button type="button" class="mini" @click="c.retry(m)">重试</button></div>
          <template v-else>
            <!-- 回话是 Markdown，走 lib/text.js 的 markdown()（先转义再加标签） -->
            <div class="chat-reply" v-html="markdown(m.content)"></div>

            <!-- 整篇重写：先确认再动手 -->
            <div v-if="m.rewrite" class="chat-changes chat-rewrite" data-kind="rewrite">
              <div class="chat-changes-head">
                <Icon name="refresh" :size="13" /><span>整篇重写</span>
                <span class="grow"></span>
                <span v-if="m.started" class="chat-done"><Icon name="check" :size="13" />已重写</span>
                <BusyBtn v-else type="button" class="mini primary" data-act="rewrite" :busy="m.running" busy-text="重写中"
                  :disabled="s.streaming || c.busy" @click="c.startRewrite(m)">开始重写</BusyBtn>
              </div>
              <ol class="chat-notes"><li v-for="(n, i) in notes(m.rewrite)" :key="i">{{ n }}</li></ol>
              <p class="chat-tip">{{ m.started ? '左边正文上方有逐段对照，哪段不满意可以单独退回；原稿留在「版本对照」里，Ctrl+Z 也能退回。' : '会按这几条把整篇重写一遍（按整篇计点）。不想整篇动，直接说「只改开头」这类话。' }}</p>
            </div>

            <!-- 局部改动 -->
            <div v-else-if="m.edits.length" class="chat-changes">
              <div class="chat-changes-head">
                <Icon name="pen" :size="13" />
                <span>{{ m.edits.length }} 处改动</span>
                <span class="grow"></span>
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
                </div>
              </div>
            </div>
            <p v-if="m.skipped.length" class="chat-skip">另有 {{ m.skipped.length }} 处没对上正文，已略过。</p>
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
      <div class="chat-input-foot">
        <span class="hint">{{ c.mic.recording ? '在听…说完点话筒' : c.mic.recognizing ? '转文字中…' : 'Enter 发送 · Shift+Enter 换行' }}</span>
        <span class="grow"></span>
        <BusyBtn type="submit" class="btn primary small" id="chatSendBtn" :busy="c.busy" :disabled="!c.input.trim() || !canSend">发送</BusyBtn>
      </div>
      <div class="chat-meta">
        <label class="chat-keep" title="超过这个天数的对话自动删掉；对你所有稿子的对话都生效">记录保存
          <select id="chatKeepSel" :value="c.keepDays" @change="c.setKeep($event.target.value)">
            <option v-for="k in KEEP_CHOICES" :key="k.days" :value="k.days">{{ k.label }}</option>
          </select>
        </label>
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
import { CHAT_SUGGESTS, KEEP_CHOICES, useChatStore } from '../stores/chat.js';
import { useStudioStore } from '../stores/studio.js';
import { useEditorStore } from '../stores/editor.js';
import { useVersionsStore } from '../stores/versions.js';
import { ask } from '../lib/feedback.js';
import { markdown } from '../lib/text.js';

const c = useChatStore();
const s = useStudioStore();
const ed = useEditorStore();
const v = useVersionsStore();
const log = ref(null);
const input = ref(null);

const clip = (t, n) => { const x = String(t || ''); return x.length > n ? `${x.slice(0, n)}…` : x; };
const notes = (t) => String(t || '').split('\n').map((x) => x.replace(/^\s*(\d+[.、)]|[-*·])\s*/, '').trim()).filter(Boolean);
const canSend = computed(() => Boolean(s.draft?.id && ed.text.trim() && !s.streaming));
const verNote = computed(() => (v.current ? `现在对着「${v.label}」版聊，改的也是这一版。` : ''));
const placeholder = computed(() => {
  if (!canSend.value) return s.streaming ? '正在生成，等写完再聊' : '有了正文才能聊';
  return '问 AI，或说要怎么改：比如「第二段太啰嗦，压短一点」';
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
watch(() => [c.messages.length, c.messages[c.messages.length - 1]?.pending], scrollEnd);
watch(() => c.focusTick, () => nextTick(() => input.value?.focus()));
/* 换了稿子或版本：取那一串的记录；引用的那段属于上一篇，不带过去 */
watch(() => s.draft?.id, () => { c.quote = ''; });
watch(() => [s.draft?.id, ed.editVer], () => { void c.load().then(scrollEnd); });
onMounted(() => {
  void c.load().then(scrollEnd);
  if (c.focusTick) input.value?.focus();
});
onBeforeUnmount(() => c.stopMic());
</script>
