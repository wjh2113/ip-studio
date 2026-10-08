/* 成稿检查：让模型回头看一遍错字、通顺性、调性与风险，逐条采纳。
 * 采纳只替换第一处：同一片段可能在文中出现多次，全替换风险太大。
 * 采纳是本地改正文，马上生效、马上定位到改过的地方；不再自动整篇重查（要等模型，整张清单还会被置灰），
 * 剩下的条目照样能点。改得多了想再看一遍，点「再检查一遍」。 */
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
  const stale = ref(false);          // 重新检查的请求还在路上（手动点「再检查一遍」）
  const applied = ref(0);            // 这次检查之后采纳了几条：提示可以再查一遍
  const result = ref(null);
  const error = ref('');
  const handled = reactive(new Set());   // 采纳或忽略过的条目

  async function run({ silent = false } = {}) {
    const s = useStudioStore();
    const draft = s.draft;
    // 一次只查一遍：出稿后的自动检查还没回来时再点，别多花一次模型调用
    if (!draft?.content?.trim() || running.value) return;
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
      applied.value = 0;
      open.value = true;
    } catch (err) {
      open.value = true;
      error.value = err.message;
    } finally {
      running.value = false;
    }
  }

  /* 手动再查一遍：旧清单留着（置灰），新的回来再换 */
  async function recheck() {
    if (running.value) return;
    stale.value = true;
    try { await run({ silent: true }); } finally { stale.value = false; }
  }

  /* 这一条在原文里还找得到吗（采纳了别的条目、自己改过之后可能对不上了） */
  const fits = (i) => {
    const issue = result.value?.issues?.[i];
    return Boolean(issue?.quote) && String(useStudioStore().draft?.content || '').includes(issue.quote);
  };

  function applyOne(i) {
    const s = useStudioStore();
    const issue = result.value?.issues?.[i];
    if (!issue || !s.draft || handled.has(i)) return false;
    handled.add(i);
    const raw = s.draft.content;
    if (!raw.includes(issue.quote)) return null;      // 原文已经改过，这条对不上了
    // 检查针对原文（编辑框里可能开着别的版本）；走编辑器，Ctrl+Z 能撤回这次采纳
    useEditorStore().replaceContent(raw.replace(issue.quote, issue.fix), '');
    applied.value += 1;
    return true;
  }

  /* 采纳：马上改、马上在左边原文定位到改过的那句 */
  function apply(i) {
    const r = applyOne(i);
    if (r === null) { toast('原文已经改过，这条对不上了'); return; }
    if (!r) return;
    void useEditorStore().locate(result.value.issues[i].fix, { quiet: true }).catch(() => {});
  }

  function applyAll() {
    let n = 0;
    (result.value?.issues || []).forEach((_, i) => { if (applyOne(i)) n += 1; });
    toast(n ? `已采纳 ${n} 处` : '没有可采纳的修改');
  }

  function skip(i) {
    handled.add(i);
  }

  /* AI 味扫描：只跑规则，不花点数，点了马上出结果。改哪句交给作者：选中它，划词菜单里点「去 AI 味」 */
  const tone = reactive({ open: false, running: false, flags: null, error: '' });
  async function scanTone() {
    const s = useStudioStore();
    const draft = s.draft;
    if (!draft?.content?.trim() || tone.running) return;
    tone.open = true;
    tone.running = true;
    tone.error = '';
    try {
      const { flags } = await api(`/drafts/${draft.id}/ai-tone`, { method: 'POST', body: { content: draft.content } });
      if (s.draft?.id === draft.id) tone.flags = flags;
    } catch (err) { tone.error = err.message; } finally { tone.running = false; }
  }

  function reset() {
    Object.assign(tone, { open: false, running: false, flags: null, error: '' });
    open.value = false;
    stale.value = false;
    applied.value = 0;
    result.value = null;
    error.value = '';
    handled.clear();
  }

  return { open, running, stale, applied, result, error, handled, fits, run, recheck, apply, applyAll, skip, reset, tone, scanTone };
});
