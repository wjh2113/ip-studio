/* 写法框架：每段干什么、各占多少篇幅。
 *   - 简报里的一排：不套框架（默认）+ 推荐的三个 + 当前选中的（如果不在推荐里）
 *   - 框架库：内置 + 我的，按平台筛；可以新建、编辑、删除、把内置的复制成自己的再改、从范文拆解
 * 选中的框架 key 存在 studio.frameworkKey，提交简报时带给后端。 */
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { api } from '../lib/api.js';
import { toast } from '../lib/feedback.js';
import { useStudioStore } from './studio.js';
import { useBriefStore } from './brief.js';

export const useFrameworksStore = defineStore('frameworks', () => {
  const recs = ref([]);            // 给当前简报推荐的
  const chosen = ref(null);        // 选中的框架对象（从框架库挑的不一定在推荐里）
  const all = ref(null);           // { builtin, mine, platforms }
  const libOpen = ref(false);

  const platforms = computed(() => all.value?.platforms || []);
  const platformLabel = (k) => platforms.value.find((p) => p.key === k)?.label || useStudioStore().platformLabel(k);
  const findKey = (key) => [...(all.value?.mine || []), ...(all.value?.builtin || [])].find((f) => f.key === key) || null;

  /* 简报那一排要显示的：推荐的 + 选中但不在推荐里的 */
  const pickList = computed(() => {
    const s = useStudioStore();
    const list = [...recs.value];
    if (s.frameworkKey && !list.some((f) => f.key === s.frameworkKey) && chosen.value?.key === s.frameworkKey) list.unshift(chosen.value);
    return list;
  });

  function choose(f) {
    useStudioStore().frameworkKey = f ? f.key : null;
    chosen.value = f || null;
  }

  /* 推荐按平台、栏目、账号、题材来 */
  async function loadRecs() {
    const s = useStudioStore();
    if (!s.user) return;
    const ctx = useBriefStore().form;
    const q = new URLSearchParams({ platform: ctx.platform || '' });
    if (s.sectionId) q.set('section_id', s.sectionId);
    if (s.personaId) q.set('persona_id', s.personaId);
    const subject = String(ctx.subject || '').trim();
    if (subject) q.set('subject', subject.slice(0, 200));
    try {
      recs.value = (await api(`/frameworks/recommend?${q}`)).frameworks;
    } catch { recs.value = []; }
  }

  async function loadAll() {
    all.value = await api('/frameworks');
    return all.value;
  }

  /* 选了带默认框架的栏目：自动带上它（作者还能在那一排里换掉） */
  async function applySectionDefault() {
    const s = useStudioStore();
    const sec = s.sections.find((x) => x.id === s.sectionId);
    const key = sec?.default_framework;
    if (!key) return;
    try {
      if (!all.value) await loadAll();
      const f = findKey(key);
      if (f) { choose(f); toast(`栏目「${sec.name}」默认用「${f.name}」的写法`); }
    } catch { /* 拉不到就算了 */ }
  }

  async function remove(f) {
    await api(`/frameworks/${f.id}`, { method: 'DELETE' });
    if (useStudioStore().frameworkKey === f.key) choose(null);
    await loadAll();
    loadRecs();
  }

  async function save(id, body) {
    const { framework } = id
      ? await api(`/frameworks/${id}`, { method: 'PUT', body })
      : await api('/frameworks', { method: 'POST', body });
    if (useStudioStore().frameworkKey === framework.key) chosen.value = framework;
    await loadAll();
    loadRecs();
    return framework;
  }

  async function copy(key) {
    const { framework } = await api('/frameworks', { method: 'POST', body: { from: key } });
    await loadAll();
    return framework;
  }

  return {
    recs, chosen, all, libOpen, platforms, pickList, platformLabel, findKey,
    choose, loadRecs, loadAll, applySectionDefault, remove, save, copy,
  };
});
