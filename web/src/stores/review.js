/* 成稿检查：让模型回头看一遍错字、通顺性、调性与风险，逐条采纳。
 * 采纳只替换第一处：同一片段可能在文中出现多次，全替换风险太大。 */
import { defineStore } from 'pinia';
import { reactive, ref } from 'vue';
import { api } from '../lib/api.js';
import { toast } from '../lib/feedback.js';
import { useStudioStore } from './studio.js';
import { useEditorStore } from './editor.js';

export const VERDICT_LABEL = { ok: '没发现问题', minor: '有几处小毛病', bad: '大面积不通顺' };

export const useReviewStore = defineStore('review', () => {
  const open = ref(false);
  const running = ref(false);
  const stale = ref(false);          // 采纳后正文变了、新的检查还没回来：先把旧清单置灰
  const result = ref(null);
  const error = ref('');
  const handled = reactive(new Set());   // 采纳或忽略过的条目

  async function run({ silent = false } = {}) {
    const s = useStudioStore();
    const draft = s.draft;
    if (!draft?.content?.trim()) return;
    await useEditorStore().flushSave();
    if (!silent) {
      open.value = true;
      result.value = null;
      error.value = '';
      handled.clear();
    }
    running.value = true;
    try {
      const { review } = await api(`/drafts/${draft.id}/review`, { method: 'POST', body: { content: draft.content } });
      if (s.draft?.id !== draft.id) return;
      result.value = review;
      error.value = '';
      handled.clear();
      open.value = true;
    } catch (err) {
      open.value = true;
      error.value = err.message;
    } finally {
      running.value = false;
    }
  }

  /* 采纳之后重新检测——但不是每采纳一条就查一次（连着点会发好几次模型调用）：
     停手 2.5 秒才查，中间再点就重新计时 */
  let recheckTimer = 0;
  function scheduleRecheck() {
    clearTimeout(recheckTimer);
    stale.value = true;
    recheckTimer = setTimeout(async () => {
      try {
        await run({ silent: true });
      } finally {
        stale.value = false;      // 结果回来了才解封——请求还在飞的时候列表里还是旧数据
      }
    }, 2500);
  }

  function applyOne(i) {
    const s = useStudioStore();
    const issue = result.value?.issues?.[i];
    if (!issue || !s.draft || handled.has(i)) return false;
    handled.add(i);
    const raw = s.draft.content;
    if (!raw.includes(issue.quote)) return null;      // 原文已经改过，这条对不上了
    s.draft.content = raw.replace(issue.quote, issue.fix);
    return true;
  }

  function apply(i) {
    const r = applyOne(i);
    if (r === null) { toast('原文已经改过，这条对不上了'); return; }
    if (!r) return;
    useEditorStore().markDirty();
    toast('已采纳');
    scheduleRecheck();
  }

  function applyAll() {
    let n = 0;
    (result.value?.issues || []).forEach((_, i) => { if (applyOne(i)) n += 1; });
    if (n) useEditorStore().markDirty();
    toast(n ? `已采纳 ${n} 处` : '没有可采纳的修改');
    if (n) scheduleRecheck();
  }

  function skip(i) {
    handled.add(i);
  }

  function reset() {
    clearTimeout(recheckTimer);
    open.value = false;
    stale.value = false;
    result.value = null;
    error.value = '';
    handled.clear();
  }

  return { open, running, stale, result, error, handled, run, apply, applyAll, skip, reset };
});
