/* 发布数据回填与复盘。
 *
 * 产品原来到「导出」就断了。回填几个数字，才能回答「什么有效」——
 * 语气档案学的是「你怎么写」，这个学的是「哪种写法数据好」。
 * 一篇可以隔几天填几次（每次一份快照），复盘时按「发布后第 7 天」同口径比。 */
import { defineStore } from 'pinia';
import { computed, reactive, ref } from 'vue';
import { api } from '../lib/api.js';
import { toast } from '../lib/feedback.js';
import { localDay } from '../lib/text.js';
import { useStudioStore } from './studio.js';

export const useInsightsStore = defineStore('insights', () => {
  /* ---------- 回填 ---------- */
  const metricsOpen = ref(false);
  const fields = ref([]);                 // 有哪些数可填：[{ key, label }]
  const history = ref([]);                // 这篇历次回填，新的在前
  const platforms = ref([]);
  const form = reactive({ published: '', on: '', platform: '', note: '', values: {} });
  const saving = ref(false);

  const draftPlatform = () => useStudioStore().draft?.platform || '';

  /* 按当前选的平台和日期：当天已经记过就带出来改；没记过就空着，占位里给上次的数做参考 */
  const sameDay = computed(() => history.value.find((h) => (h.platform || draftPlatform()) === form.platform && h.capturedOn === form.on) || null);
  const lastBefore = computed(() => history.value.find((h) => (h.platform || draftPlatform()) === form.platform && h.capturedOn < form.on) || null);

  function fill() {
    const hit = sameDay.value;
    form.note = hit?.note || '';
    form.values = Object.fromEntries(fields.value.map((f) => [f.key, hit?.[f.key] ?? '']));
  }

  async function openMetrics() {
    const s = useStudioStore();
    if (!s.draft?.id) return;
    if (!fields.value.length) {
      try { fields.value = (await api('/metrics')).fields; } catch { return; }
    }
    try {
      const d = await api(`/drafts/${s.draft.id}/metrics`);
      history.value = d.history || [];
      platforms.value = d.platforms?.length ? d.platforms : [s.draft.platform];
    } catch (err) { toast(err.message); return; }
    form.published = s.draft.published_at || localDay();
    form.on = localDay();
    form.platform = s.draft.platform;
    fill();
    metricsOpen.value = true;
  }

  function applySaved(out) {
    const s = useStudioStore();
    if (s.draft) {
      s.draft.metrics = out.metrics;
      s.draft.published_at = out.published_at;
    }
    history.value = out.history || [];
  }

  async function saveMetrics() {
    const s = useStudioStore();
    if (saving.value || !s.draft) return;
    const body = { published_at: form.published, captured_on: form.on, platform: form.platform, note: form.note };
    for (const [k, v] of Object.entries(form.values)) if (v !== '' && v != null) body[k] = Number(v);
    saving.value = true;
    try {
      const out = await api(`/drafts/${s.draft.id}/metrics`, { method: 'POST', body });
      applySaved(out);
      metricsOpen.value = false;
      toast(out.removed ? '已删掉这一天的记录' : '已记下，过几天可以再填一次看走势');
    } catch (err) { toast(err.message); } finally { saving.value = false; }
  }

  async function deleteSnap(id) {
    const s = useStudioStore();
    applySaved(await api(`/drafts/${s.draft.id}/metrics/${id}`, { method: 'DELETE' }));
    fill();
  }

  /* ---------- 复盘 ---------- */
  const insightsOpen = ref(false);
  const report = ref(null);
  const reportError = ref('');

  async function openInsights() {
    metricsOpen.value = false;
    insightsOpen.value = true;
    report.value = null;
    reportError.value = '';
    try {
      const s = useStudioStore();
      report.value = await api(`/insights${s.personaId ? `?persona=${s.personaId}` : ''}`);
    } catch (err) { reportError.value = err.message; }
  }

  return {
    metricsOpen, fields, history, platforms, form, saving, lastBefore, fill, openMetrics, saveMetrics, deleteSnap,
    insightsOpen, report, reportError, openInsights,
  };
});
