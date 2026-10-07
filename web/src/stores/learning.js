/* 越写越懂：个人档案（跟着人走，所有账号共用）与「AI 眼中的我」（某个账号学到的语气档案、改稿习惯、学习记录）。
 * 右上角「个人档案」页，以及账号设定页的「语气样本」「AI 眼中的我」用它。学习本身在服务端（server/learning.js）。 */
import { defineStore } from 'pinia';
import { reactive, ref } from 'vue';
import { api, upload } from '../lib/api.js';
import { ask, toast } from '../lib/feedback.js';
import { useJobsStore } from './jobs.js';
import { on } from '../lib/bus.js';

export const PROFILE_KIND = { work: '工作经历', project: '项目经历', data: '数据成果', opinion: '观点', other: '其他' };
const EMPTY = { kind: 'work', title: '', period: '', org: '', role: '', body: '', result: '', tags: '', visibility: 'public' };

export const useLearningStore = defineStore('learning', () => {
  /* ---------- 个人档案（右上角头像打开，整屏页面） ---------- */
  const profileOpen = ref(false);
  function openProfile() { profileOpen.value = true; }
  function closeProfile() { profileOpen.value = false; }

  const profile = reactive({ entries: [], max: 300, loading: false, error: '' });
  const editing = ref(null);               // 正在改的那条 id；'new' = 新增
  const form = reactive({ ...EMPTY });
  const parse = reactive({ text: '', running: false, reading: false, candidates: [], error: '' });

  async function loadProfile() {
    profile.loading = true;
    profile.error = '';
    try {
      const out = await api('/profile');
      profile.entries = out.entries || [];
      profile.max = out.max || 300;
    } catch (err) { profile.error = err.message; } finally { profile.loading = false; }
  }

  function startNew(kind = 'work') {
    Object.assign(form, { ...EMPTY, kind });
    editing.value = 'new';
  }
  function startEdit(e) {
    Object.assign(form, { ...EMPTY, ...e });
    editing.value = e.id;
  }
  function cancelEdit() { editing.value = null; }

  async function saveEntry() {
    if (!form.title.trim()) { toast('给这条经历写个标题'); return; }
    const body = { ...form };
    try {
      if (editing.value === 'new') await api('/profile', { method: 'POST', body });
      else await api(`/profile/${editing.value}`, { method: 'PUT', body });
      editing.value = null;
      await loadProfile();
      toast('已存进个人档案');
    } catch (err) { toast(err.message); }
  }

  async function removeEntry(e) {
    if (!await ask.confirm({ title: `删掉「${e.title}」？`, body: '以后写作不会再用到这条经历。', ok: '删除', danger: true })) return;
    try {
      await api(`/profile/${e.id}`, { method: 'DELETE' });
      await loadProfile();
    } catch (err) { toast(err.message); }
  }

  /* 贴简历 → 拆成候选，默认全选，作者勾掉不要的再存 */
  async function runParse() {
    parse.error = '';
    parse.running = true;
    try {
      const { entries } = await api('/profile/parse', { method: 'POST', body: { text: parse.text } });
      parse.candidates = entries.map((e) => ({ ...e, pick: true }));
      if (!entries.length) parse.error = '没拆出能核对上原文的经历，换一段更具体的试试';
    } catch (err) { parse.error = err.message; } finally { parse.running = false; }
  }

  async function saveParsed() {
    const list = parse.candidates.filter((c) => c.pick);
    if (!list.length) { toast('先勾选要存的经历'); return; }
    try {
      const out = await api('/profile/batch', { method: 'POST', body: { entries: list, source: 'resume' } });
      profile.entries = out.entries;
      parse.candidates = [];
      parse.text = '';
      toast(`存了 ${out.saved} 条`);
    } catch (err) { toast(err.message); }
  }

  /* ---------- AI 眼中的我（按账号） ---------- */
  const me = reactive({
    personaId: null, digest: '', digestUpdatedAt: '', autoLearn: true, samples: { count: 0, max: 200, untilFull: 10 },
    prefs: [], prefMax: 40, profileCount: 0, log: [], data: null, semantic: null, loading: false, error: '',
  });
  const newRule = ref('');

  async function loadMe(personaId) {
    me.personaId = personaId;
    me.error = '';
    if (!personaId) return;
    me.loading = true;
    try {
      const out = await api(`/personas/${personaId}/learning`);
      if (me.personaId !== personaId) return;
      Object.assign(me, out);
    } catch (err) { me.error = err.message; } finally { me.loading = false; }
  }

  async function setAutoLearn(on) {
    try {
      await api(`/personas/${me.personaId}/auto-learn`, { method: 'PUT', body: { on } });
      me.autoLearn = on;
      toast(on ? '已打开：标记发布后自动学这一篇' : '已关闭自动学习');
    } catch (err) { toast(err.message); }
  }

  async function rebuild() {
    try {
      const { job } = await api(`/personas/${me.personaId}/digest/rebuild`, { method: 'POST', body: {} });
      if (job) useJobsStore().track(job);
      toast('已在后台从头梳理，右上角「任务」里看进度');
    } catch (err) { toast(err.message); }
  }

  async function addRule() {
    const rule = newRule.value.trim();
    if (!rule) return;
    try {
      await api(`/personas/${me.personaId}/prefs`, { method: 'POST', body: { rule } });
      newRule.value = '';
      await loadMe(me.personaId);
    } catch (err) { toast(err.message); }
  }
  async function updateRule(p, patch) {
    try {
      const { pref } = await api(`/personas/${me.personaId}/prefs/${p.id}`, { method: 'PUT', body: patch });
      Object.assign(p, pref);
    } catch (err) { toast(err.message); }
  }
  async function editRule(p) {
    const v = await ask.form({ title: '改这条习惯', fields: [{ key: 'rule', label: '规则', value: p.rule, required: true }], ok: '保存' });
    if (v) await updateRule(p, { rule: v.rule });
  }
  async function removeRule(p) {
    if (!await ask.confirm({ title: '删掉这条改稿习惯？', body: p.rule, ok: '删除', danger: true })) return;
    try {
      await api(`/personas/${me.personaId}/prefs/${p.id}`, { method: 'DELETE' });
      me.prefs = me.prefs.filter((x) => x.id !== p.id);
    } catch (err) { toast(err.message); }
  }

  /* 文章里找到的经历候选：勾选存进个人档案，或者忽略 */
  async function acceptCandidates(entry, picked) {
    try {
      const out = await api('/profile/batch', { method: 'POST', body: { entries: picked, source: 'article', logId: entry.id } });
      entry.status = 'done';
      profile.entries = out.entries;
      me.profileCount = out.entries.length;
      toast(picked.length ? `存了 ${out.saved} 条进个人档案` : '已忽略');
    } catch (err) { toast(err.message); }
  }
  async function dismissCandidates(entry) {
    try {
      await api(`/learning/log/${entry.id}/dismiss`, { method: 'POST', body: {} });
      entry.status = 'done';
    } catch (err) { toast(err.message); }
  }

  /* ---------- 批量导入文章（语气样本） ---------- */
  const imp = reactive({ files: [], failed: [], paste: '', pasteTitle: '', running: false, reading: false, result: null });

  /* 选文件：.md / .txt 在浏览器里读；Word（.docx）和 PDF 传给服务端取文字。
     文件名当标题，正文第一行是 # 标题的、或者文档里带标题的用它。读不了的列出来告诉作者为什么 */
  const DOC_RE = /\.(docx|pdf)$/i;
  async function readFileText(f) {
    if (DOC_RE.test(f.name)) {
      const out = await upload('/files/extract', f, f.name);
      return { title: out.title, text: out.text, warnings: out.warnings || [] };
    }
    const text = (await f.text()).trim();
    return { title: text.match(/^#\s+(.+)$/m)?.[1] || '', text, warnings: [] };
  }

  async function pickFiles(fileList) {
    const out = [];
    const failed = [];
    const list = [...(fileList || [])].filter((f) => /\.(md|markdown|txt|docx|pdf)$/i.test(f.name)).slice(0, 20);
    if (!list.length) { toast('支持 .docx、.pdf、.md、.txt'); return; }
    imp.reading = true;
    try {
      for (const f of list) {
        try {
          const r = await readFileText(f);
          out.push({ title: (r.title || f.name.replace(/\.[^.]+$/, '')).slice(0, 120), content: r.text.trim(), file: f.name, warnings: r.warnings });
        } catch (err) { failed.push({ file: f.name, reason: err.message }); }
      }
    } finally { imp.reading = false; }
    imp.files = out;
    imp.failed = failed;
    if (failed.length && !out.length) toast(`没读出来：${failed[0].reason}`);
  }

  /* 简历是 Word / PDF：读出文字放进「贴简历」的框里，作者看一眼再拆 */
  async function pickResume(file) {
    if (!file) return;
    parse.error = '';
    parse.reading = true;
    try {
      const r = await readFileText(file);
      const text = r.text.trim();
      parse.text = text.slice(0, 12000);
      if (text.length > 12000) toast('简历超过 1.2 万字，只放进了前面一部分，剩下的可以分次拆');
      else if (r.warnings.length) toast(r.warnings[0]);
    } catch (err) { parse.error = err.message; } finally { parse.reading = false; }
  }

  async function runImport(personaId) {
    const articles = imp.files.map(({ title, content }) => ({ title, content }));
    if (imp.paste.trim()) articles.push({ title: imp.pasteTitle.trim(), content: imp.paste.trim() });
    if (!articles.length) { toast('先选文件或粘贴一篇'); return null; }
    imp.running = true;
    try {
      const out = await api(`/personas/${personaId}/samples/import`, { method: 'POST', body: { articles } });
      if (out.job) useJobsStore().track(out.job);
      imp.result = out;
      imp.files = [];
      imp.failed = [];
      imp.paste = '';
      imp.pasteTitle = '';
      toast(out.added ? `导入了 ${out.added} 篇，正在后台学习` : '没有导入成功的文章');
      return out;
    } catch (err) { toast(err.message); return null; } finally { imp.running = false; }
  }

  /* 学习任务做完：「AI 眼中的我」开着就刷新；告诉账号设定页重新拉样本（它听 learn-done 自己决定） */
  const learnedAt = ref(0);
  on('job-done', (job) => {
    if (job?.kind !== 'learn') return;
    learnedAt.value = Date.now();
    if (me.personaId && job.payload?.personaId === me.personaId) loadMe(me.personaId);
  });

  return {
    learnedAt,
    profileOpen, openProfile, closeProfile,
    profile, editing, form, parse, loadProfile, startNew, startEdit, cancelEdit, saveEntry, removeEntry, runParse, saveParsed,
    me, newRule, loadMe, setAutoLearn, rebuild, addRule, updateRule, editRule, removeRule, acceptCandidates, dismissCandidates,
    imp, pickFiles, pickResume, runImport,
  };
});
