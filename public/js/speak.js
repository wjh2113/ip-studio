/* 前端 · speak：口播提示、口播记录与评测、提词器。从原 app.js 原样拆出。 */
import { api, busy, el, esc, state, toast } from './core.js';
import { setDraft } from './brief.js';
import { flushSave, setMode } from './editor.js';
import { activeJob, startJob, trackJob, waitJob } from './jobs.js';

/* ==================================================================
 * 口播提示：语气 / 重读 / 停顿 / 表情 / 动作
 * 单独一层，正文保持干净
 * ================================================================== */

el.cuesRunBtn.addEventListener('click', runCues);

async function runCues() {
  const draft = state.draft;
  if (!draft?.content?.trim()) { toast('还没有正文'); return; }
  await flushSave();

  el.cueList.innerHTML = '<div class="idea-skeleton"></div>'.repeat(3);
  await busy(el.cuesRunBtn, async () => {
    try {
      const { cues } = await api(`/drafts/${draft.id}/cues`, { method: 'POST', body: {} });
      state.draft.cues = cues;
      renderCues(cues);
    } catch (err) {
      el.cueList.innerHTML = `<div class="ideas-state error">${esc(err.message)}</div>`;
    }
  });
}

export function renderCues(cues) {
  el.cuesRunBtn.textContent = cues ? '重新生成' : '生成口播提示';
  el.copyCuesBtn.classList.toggle('hidden', !cues);
  el.prompterBtn.classList.toggle('hidden', !cues);
  if (el.speakUploadBtn) el.speakUploadBtn.disabled = !cues;

  if (!cues) {
    el.cuesOverall.innerHTML = '';
    el.cueList.innerHTML = '';
    return;
  }

  const o = cues.overall || {};
  el.cuesOverall.innerHTML = [
    ['整体基调', o.tone], ['语速节奏', o.pace], ['出镜提醒', o.note],
  ].filter(([, v]) => v)
    .map(([k, v]) => `<div class="row"><b>${k}</b><span>${esc(v)}</span></div>`).join('')
    + (cues.trimmed
      ? `<div class="cues-note">改稿后有 ${cues.trimmed} 条对不上，已拿掉。还在的下一遍仍按这套提示评。</div>` : '')
    + (cues.coverage < 60
      ? `<div class="cues-note">只覆盖了正文约 ${cues.coverage}%——标题、标签这类不念的内容会跳过</div>` : '');

  el.cueList.innerHTML = cues.cues.map((c, i) => {
    const marks = [
      c.emotion ? ['emotion', '语气', c.emotion] : null,
      c.stress?.length ? ['stress', '重读', c.stress.join('、')] : null,
      c.pause ? ['pause', '停顿', c.pause] : null,
      c.expression ? ['exp', '表情', c.expression] : null,
      c.gesture ? ['ges', '动作', c.gesture] : null,
    ].filter(Boolean);

    return `
    <div class="cue" data-cue="${i}">
      <div class="cue-text">${highlightStress(c.quote, c.stress)}</div>
      <div class="cue-marks">${marks
        .map(([cls, k, v]) => `<span class="cue-mark ${cls}"><b>${k}</b>${esc(v)}</span>`).join('')}</div>
    </div>`;
  }).join('');
}

/* ==================================================================
 * 口播记录：上传录音 → 总评留档。改稿不会清掉这些记录。
 * ================================================================== */

function speakStamp(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/* 纯音频没有画面，视频测评按钮置灰（网关对纯音频也会回 400） */
const speakAudioOnly = (s) => /^audio\//i.test(s.mime || '')
  || (!s.mime && /\.(mp3|wav|m4a|ogg|aac)$/i.test(s.audio || ''));

/* 语音 / 视频测评按钮：任务在跑时显示「测评中…」，刷新页面后也一样 */
function checkBtn(s, kind) {
  const voice = kind === 'pronounce';
  const attr = voice ? 'data-speak-pron' : 'data-speak-look';
  if (activeJob(kind, (p) => p.speakId === s.id)) {
    return `<button type="button" class="btn ghost small" ${attr}="${s.id}" disabled>测评中…</button>`;
  }
  if (!voice && speakAudioOnly(s)) {
    return `<button type="button" class="btn ghost small" ${attr}="${s.id}" disabled title="这一遍只有声音、没有画面，不做出镜评测">视频测评</button>`;
  }
  const again = voice ? s.review.checks?.voice : s.review.checks?.video;
  const name = voice ? '语音测评' : '视频测评';
  return `<button type="button" class="btn ghost small" ${attr}="${s.id}">${again ? `重新${name}` : name}</button>`;
}

function speakReviewHtml(s) {
  if (s.status === 'failed') {
    return `<div class="speak-fail">${esc(s.error || '评估失败')}</div>
      <button class="btn ghost small" data-speak-retry="${s.id}">重新评估</button>`;
  }
  if (s.status !== 'ready' || !s.review) return '<div class="hint">正在转写和总评…可以先去做别的，好了会提示</div>';
  const dims = (s.review.dims || []).map((d) => `
    <div class="speak-dim"><b>${esc(d.key)}</b><span>${d.score == null ? '—' : d.score}</span>
      <em>${esc(d.note || '')}</em></div>`).join('');
  const lifts = (s.review.lifts || []).map((l) => `
    <li><b>${esc(l.quote || '整遍')}</b>　${esc(l.do)}${l.lose ? ` <span class="hint">−${l.lose}</span>` : ''}</li>`).join('');
  return `
    <div class="speak-score">${s.review.score == null ? '—' : s.review.score}<em>分</em></div>
    <div class="speak-dims">${dims}</div>
    ${lifts ? `<ol class="speak-lifts">${lifts}</ol>` : ''}
    <p class="speak-next">${esc(s.review.next || '')}</p>
    <div class="speak-extra">
      ${checkBtn(s, 'pronounce')}
      ${checkBtn(s, 'appearance')}
    </div>
    ${s.audio ? `<audio controls preload="none" src="${esc(s.audio)}"></audio>` : ''}`;
}

function replaceSpeak(speak) {
  state.focusSpeakId = speak.id;
  const list = state.speaks || [];
  state.speaks = list.some((s) => s.id === speak.id)
    ? list.map((s) => (s.id === speak.id ? speak : s))
    : [speak, ...list];
  renderDraftSpeaks();
  document.querySelectorAll('.speak-orphan').forEach((n) => { n.innerHTML = speakReviewHtml(speak); });
}

async function runSpeakCheck(id, kind) {
  const path = kind === 'video' ? `/speaks/${id}/appearance` : `/speaks/${id}/pronounce`;
  const { job } = await startJob(path);
  await waitJob(job);
  const { speak: next } = await api(`/speaks/${id}`);
  replaceSpeak(next);
  toast(kind === 'video' ? '视频测评好了' : '语音测评好了');
}

export async function onSpeakCheck(e) {
  const pron = e.target.closest('[data-speak-pron]');
  const look = e.target.closest('[data-speak-look]');
  const btn = pron || look;
  if (!btn) return false;
  e.stopPropagation();
  e.preventDefault();
  const id = Number(pron ? btn.dataset.speakPron : btn.dataset.speakLook);
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = '测评中…';
  try {
    await runSpeakCheck(id, pron ? 'voice' : 'video');
  } catch (err) {
    toast(err.message);
    btn.disabled = false;
    btn.textContent = label;
  }
  return true;
}

function renderDraftSpeaks() {
  if (!el.speakList) return;
  const list = state.speaks || [];
  if (!list.length) {
    el.speakList.innerHTML = '<p class="hint">还没有口播记录。</p>';
    return;
  }
  el.speakList.innerHTML = list.map((s) => {
    const mark = s.draftGone ? '稿子已不在' : (s.stale ? '当时的稿子' : '');
    const open = state.focusSpeakId === s.id;
    return `
    <div class="speak-row ${open ? 'open' : ''}" data-speak-row="${s.id}">
      <button type="button" class="speak-sum" data-speak-open="${s.id}">
        <b>${s.score == null ? '—' : s.score}</b>
        <span>${esc(speakStamp(s.createdAt))}</span>
        <span class="grow">${esc(s.status === 'running' ? '正在转写和总评…' : (s.next || s.error || (s.status === 'failed' ? '评估失败' : '')))}</span>
        ${mark ? `<em>${mark}</em>` : ''}
      </button>
      <button type="button" class="mini del" data-speak-del="${s.id}" title="删除这遍">删除</button>
      ${open ? `<div class="speak-detail">${speakReviewHtml(s)}</div>` : ''}
    </div>`;
  }).join('');
}

export async function loadDraftSpeaks() {
  if (!state.draft || state.mode !== 'cue') return;
  try {
    const { speaks } = await api(`/drafts/${state.draft.id}/speaks`);
    state.speaks = speaks;
    if (el.cntSpeaks) el.cntSpeaks.textContent = '';
    renderDraftSpeaks();
  } catch (err) { toast(err.message); }
}

export async function loadSpeakHistory() {
  try {
    const { speaks } = await api('/speaks');
    state.speakHistory = speaks;
    if (el.cntSpeaks) el.cntSpeaks.textContent = speaks.length || '';
    el.historyFoot.classList.add('hidden');
    if (!speaks.length) {
      el.history.innerHTML = '<div class="empty">还没有口播记录<br />生成口播提示后上传录音</div>';
      return;
    }
    el.history.innerHTML = speaks.map((s) => `
      <div class="history-item ${state.focusSpeakId === s.id ? 'active' : ''}" data-speak="${s.id}">
        <div class="acts">
          <button class="del" data-speak-del="${s.id}" title="删除">×</button>
        </div>
        <h4>${s.score == null ? '—' : `${s.score} 分`}　${esc(s.title || '未命名')}</h4>
        <p><span>${esc(speakStamp(s.createdAt))}</span><span>·</span>
          <span>${esc(s.draftGone ? '稿子已不在' : (s.stale ? '当时的稿子' : (s.next || s.error || '总评')))}</span></p>
      </div>`).join('');
  } catch { /* 未登录时静默 */ }
}

export async function openSpeakRecord(id) {
  let speak = (state.speaks || []).find((s) => s.id === id)
    || (state.speakHistory || []).find((s) => s.id === id);
  try {
    const got = await api(`/speaks/${id}`);
    speak = got.speak;
  } catch (err) { toast(err.message); return; }
  state.focusSpeakId = id;
  if (!speak.draftId || speak.draftGone) {
    document.querySelectorAll('.speak-orphan').forEach((n) => n.remove());
    const item = el.history.querySelector(`[data-speak="${id}"]`);
    if (item) {
      const box = document.createElement('div');
      box.className = 'speak-orphan';
      box.innerHTML = speakReviewHtml(speak);
      item.appendChild(box);
    }
    toast(speak.draftGone ? '稿子已经不在了，这是当时的总评' : '这遍口播还在');
    return;
  }
  if (state.draft?.id !== speak.draftId) {
    const { draft } = await api(`/drafts/${speak.draftId}`);
    setDraft(draft);
  }
  if (state.mode !== 'cue') setMode('cue');
  else loadDraftSpeaks();
}

el.speakUploadBtn?.addEventListener('click', () => {
  if (!state.draft?.cues?.cues?.length) { toast('先生成口播提示'); return; }
  el.speakFile.click();
});

el.speakFile?.addEventListener('change', async () => {
  const file = el.speakFile.files?.[0];
  el.speakFile.value = '';
  if (!file || !state.draft) return;
  if (file.size > 24 * 1024 * 1024) { toast('录音请小于 24MB'); return; }
  el.speakUploadBtn.disabled = true;
  el.speakUploadBtn.textContent = '上传中…';
  try {
    const res = await fetch(`/api/drafts/${state.draft.id}/speaks?async=1`, {
      method: 'POST',
      headers: {
        'Content-Type': file.type || 'application/octet-stream',
        'X-Filename': encodeURIComponent(file.name || 'take.webm'),
      },
      body: file,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `上传失败（${res.status}）`);
    state.focusSpeakId = data.speak?.id || null;
    if (data.job) trackJob(data.job);
    toast('录音已上传，正在转写和总评。可以先去做别的，好了会提示');
    await loadDraftSpeaks();
    if (state.historyMode === 'speaks') loadSpeakHistory();
  } catch (err) {
    toast(err.message);
  } finally {
    el.speakUploadBtn.disabled = !state.draft?.cues?.cues?.length;
    el.speakUploadBtn.textContent = '上传音视频';
  }
});

el.speakList?.addEventListener('click', async (e) => {
  if (await onSpeakCheck(e)) return;
  const retry = e.target.closest('[data-speak-retry]');
  if (retry) {
    const id = Number(retry.dataset.speakRetry);
    retry.disabled = true;
    retry.textContent = '评估中…';
    try {
      const { speak } = await startJob(`/speaks/${id}/retry`);
      state.focusSpeakId = speak.id;
      await loadDraftSpeaks();
      if (state.historyMode === 'speaks') loadSpeakHistory();
    } catch (err) { toast(err.message); }
    return;
  }
  const del = e.target.closest('[data-speak-del]');
  if (del) {
    const id = Number(del.dataset.speakDel);
    if (!await ask.confirm({ title: '删除这一遍口播记录？', body: '录音和总评会一起去掉。', ok: '删除', danger: true })) return;
    try {
      await api(`/speaks/${id}`, { method: 'DELETE' });
      if (state.focusSpeakId === id) state.focusSpeakId = null;
      toast('已删除这遍口播');
      await loadDraftSpeaks();
      if (state.historyMode === 'speaks') loadSpeakHistory();
    } catch (err) { toast(err.message); }
    return;
  }
  const open = e.target.closest('[data-speak-open]');
  if (!open) return;
  const id = Number(open.dataset.speakOpen);
  state.focusSpeakId = state.focusSpeakId === id ? null : id;
  renderDraftSpeaks();
});

/* 把要重读的词标出来（先转义再替换，避免把标签打散） */
function highlightStress(quote, stress = []) {
  let html = esc(quote);
  for (const word of stress) {
    const safe = esc(word).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (safe) html = html.replace(new RegExp(safe, 'g'), (m) => `<mark>${m}</mark>`);
  }
  return html;
}

/* 导出成可以直接照着念的稿子 */
el.copyCuesBtn.addEventListener('click', async () => {
  const cues = state.draft?.cues;
  if (!cues) return;
  const o = cues.overall || {};
  const head = [
    `【整体基调】${o.tone || '—'}`,
    `【语速节奏】${o.pace || '—'}`,
    o.note ? `【出镜提醒】${o.note}` : null,
  ].filter(Boolean).join('\n');

  const body = cues.cues.map((c) => {
    const marks = [
      c.emotion ? `语气：${c.emotion}` : null,
      c.stress?.length ? `重读：${c.stress.join('、')}` : null,
      c.pause ? `停顿：${c.pause}` : null,
      c.expression ? `表情：${c.expression}` : null,
      c.gesture ? `动作：${c.gesture}` : null,
    ].filter(Boolean).join('　');
    return `${c.quote}\n（${marks}）`;
  }).join('\n\n');

  try {
    await navigator.clipboard.writeText(`${head}\n\n${'—'.repeat(20)}\n\n${body}\n`);
    toast('口播稿已复制');
  } catch {
    toast('复制失败，请手动选中');
  }
});

/* ==================================================================
 * 提词器：把口播提示切好的段落全屏滚动播出来
 * ================================================================== */

const PROMPTER_DEFAULTS = { speed: 40, size: 40, cues: true, mirror: false };

const prompter = {
  raf: null,
  playing: false,
  offset: 0,
  last: 0,
  max: 0,
  wakeLock: null,
  cfg: { ...PROMPTER_DEFAULTS },
};

function loadPrompterCfg() {
  try {
    const saved = JSON.parse(localStorage.getItem('cw.prompter') || 'null');
    if (saved) prompter.cfg = { ...PROMPTER_DEFAULTS, ...saved };
  } catch { /* 用默认值 */ }
}

const savePrompterCfg = () => localStorage.setItem('cw.prompter', JSON.stringify(prompter.cfg));

el.prompterBtn.addEventListener('click', openPrompter);

function openPrompter() {
  const cues = state.draft?.cues;
  if (!cues?.cues?.length) { toast('先生成口播提示'); return; }
  loadPrompterCfg();

  el.pBody.innerHTML = cues.cues.map((c) => {
    const marks = [
      c.emotion ? ['语气', c.emotion] : null,
      c.pause ? ['停顿', c.pause] : null,
      c.expression ? ['表情', c.expression] : null,
      c.gesture ? ['动作', c.gesture] : null,
    ].filter(Boolean);
    return `
    <div class="pseg">
      <div class="pseg-text">${highlightStress(c.quote, c.stress)}</div>
      ${marks.length ? `<div class="pseg-cues">${marks
        .map(([k, v]) => `<span><b>${k}</b> ${esc(v)}</span>`).join('')}</div>` : ''}
    </div>`;
  }).join('');

  el.prompter.classList.remove('hidden');
  applyPrompterCfg();
  resetPrompter();
  requestWakeLock();
  // 布局稳定后再量高度
  setTimeout(measurePrompter, 60);
}

function applyPrompterCfg() {
  const { size, cues, mirror, speed } = prompter.cfg;
  el.pBody.style.fontSize = `${size}px`;
  el.prompter.classList.toggle('no-cues', !cues);
  el.prompter.classList.toggle('mirrored', mirror);
  applyTransform();
  el.pCues.classList.toggle('on', cues);
  el.pCues.textContent = cues ? '提示 开' : '提示 关';
  el.pMirror.classList.toggle('on', mirror);
  el.pSpeedVal.textContent = speed;
  el.pSizeVal.textContent = size;
  measurePrompter();
}

/* 手动挪动画面：播放中也能用，挪完接着按新位置滚 */
function nudge(delta) {
  prompter.offset = clamp(prompter.offset + delta, 0, prompter.max);
  applyTransform();
  updateProgress();
}

/* 一行的高度 —— .pseg-text 的 line-height 是 1.55 */
const lineStep = () => Math.round(prompter.cfg.size * 1.55);

/* 滚动位移和镜像必须写在同一个 transform 里：
   行内 transform 会整个覆盖 CSS 里的规则，分开写镜像就没了 */
function applyTransform() {
  const flip = prompter.cfg.mirror ? ' scaleX(-1)' : '';
  el.pBody.style.transform = `translateY(${-prompter.offset}px)${flip}`;
}

/* 滚到最后一段能停在阅读线上就够了，不用把整块留白都滚完 */
function measurePrompter() {
  const last = el.pBody.lastElementChild;
  prompter.max = last
    ? Math.max(0, last.offsetTop + last.offsetHeight - el.pStage.clientHeight * 0.32)
    : 0;
  updateProgress();
}

function resetPrompter() {
  pausePrompter();
  prompter.offset = 0;
  applyTransform();
  updateProgress();
}

function updateProgress() {
  const pct = prompter.max ? Math.min(100, Math.round((prompter.offset / prompter.max) * 100)) : 0;
  el.pProgress.textContent = `${pct}%`;
}

function playPrompter() {
  if (prompter.playing) return;
  prompter.playing = true;
  prompter.last = performance.now();
  el.pPlay.textContent = '❚❚ 暂停';
  const step = (now) => {
    if (!prompter.playing) return;
    const dt = (now - prompter.last) / 1000;
    prompter.last = now;
    prompter.offset = Math.min(prompter.max, prompter.offset + prompter.cfg.speed * dt);
    applyTransform();
    updateProgress();
    if (prompter.offset >= prompter.max) { pausePrompter(); return; }
    prompter.raf = requestAnimationFrame(step);
  };
  prompter.raf = requestAnimationFrame(step);
}

function pausePrompter() {
  prompter.playing = false;
  if (prompter.raf) cancelAnimationFrame(prompter.raf);
  prompter.raf = null;
  el.pPlay.textContent = '▶ 开始';
}

const togglePrompter = () => (prompter.playing ? pausePrompter() : playPrompter());

function closePrompterNow() {
  pausePrompter();
  el.prompter.classList.add('hidden');
  releaseWakeLock();
}

function closePrompter() {
  if (pRec && pRec.state === 'recording') {
    pRec.stop();
    return;
  }
  closePrompterNow();
}

/* 提词器里直接录。停下来走原来的口播上传，总评完关掉提词器，结果进这篇的口播列表。 */
let pRec = null;

let pChunks = [];

let pRecTimer = null;

const PROMPTER_REC_MS = 8 * 60 * 1000;

function setPRec(recording) {
  if (!el.pRec) return;
  el.pRec.classList.toggle('rec', recording);
  el.pRec.disabled = false;
  el.pRec.textContent = recording ? '■ 停止' : '● 录';
}

function audioMime() {
  if (typeof MediaRecorder === 'undefined') return '';
  if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) return 'audio/webm;codecs=opus';
  if (MediaRecorder.isTypeSupported('audio/webm')) return 'audio/webm';
  return '';
}

async function togglePrompterRec() {
  if (!state.draft?.cues?.cues?.length) { toast('先生成口播提示'); return; }
  if (typeof MediaRecorder === 'undefined') { toast('这个浏览器不能在页面里录音'); return; }
  if (pRec && pRec.state === 'recording') { pRec.stop(); return; }
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    toast('没有拿到麦克风');
    return;
  }
  const mime = audioMime();
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  pChunks = [];
  rec.ondataavailable = (ev) => { if (ev.data?.size) pChunks.push(ev.data); };
  rec.onstop = () => {
    stream.getTracks().forEach((t) => t.stop());
    if (pRecTimer) { clearTimeout(pRecTimer); pRecTimer = null; }
    pRec = null;
    setPRec(false);
    const blob = new Blob(pChunks, { type: rec.mimeType || 'audio/webm' });
    pChunks = [];
    closePrompterNow();
    if (blob.size > 0) submitPrompterTake(blob);
    else toast('没有录到声音');
  };
  pRec = rec;
  rec.start();
  setPRec(true);
  pRecTimer = setTimeout(() => {
    if (pRec && pRec.state === 'recording') {
      toast('录音已到 8 分钟，先停下来评估');
      pRec.stop();
    }
  }, PROMPTER_REC_MS);
}

async function submitPrompterTake(blob) {
  if (!state.draft) return;
  if (blob.size > 24 * 1024 * 1024) { toast('录音请小于 24MB'); return; }
  toast('正在评估这一遍');
  try {
    const res = await fetch(`/api/drafts/${state.draft.id}/speaks?async=1`, {
      method: 'POST',
      headers: {
        'Content-Type': blob.type || 'audio/webm',
        'X-Filename': 'prompter.webm',
      },
      body: blob,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `上传失败（${res.status}）`);
    state.focusSpeakId = data.speak?.id || null;
    if (data.job) trackJob(data.job);
    if (state.mode !== 'cue') setMode('cue');
    else await loadDraftSpeaks();
    if (state.historyMode === 'speaks') loadSpeakHistory();
    toast('录音已上传，正在转写和总评。好了会提示');
  } catch (err) {
    toast(err.message);
  }
}

/* 录制时别让屏幕睡过去 */
async function requestWakeLock() {
  try { prompter.wakeLock = await navigator.wakeLock?.request('screen'); } catch { /* 不支持就算了 */ }
}

function releaseWakeLock() {
  try { prompter.wakeLock?.release(); } catch { /* 忽略 */ }
  prompter.wakeLock = null;
}

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

function bump(key, delta, lo, hi) {
  prompter.cfg[key] = clamp(prompter.cfg[key] + delta, lo, hi);
  savePrompterCfg();
  applyPrompterCfg();
}

el.pPlay.addEventListener('click', togglePrompter);

el.pRec?.addEventListener('click', () => { togglePrompterRec().catch((err) => toast(err.message)); });

el.pRestart.addEventListener('click', resetPrompter);

el.pClose.addEventListener('click', closePrompter);

el.pCues.addEventListener('click', () => {
  prompter.cfg.cues = !prompter.cfg.cues;
  savePrompterCfg();
  applyPrompterCfg();
});

el.pMirror.addEventListener('click', () => {
  prompter.cfg.mirror = !prompter.cfg.mirror;
  savePrompterCfg();
  applyPrompterCfg();
});

el.prompter.addEventListener('click', (e) => {
  const speed = e.target.closest('button[data-speed]');
  const size = e.target.closest('button[data-size]');
  if (speed) bump('speed', Number(speed.dataset.speed) * 5, 10, 200);
  if (size) bump('size', Number(size.dataset.size) * 4, 20, 96);
});

/* 点画面本身也能播放/暂停，录制时不用去够按钮 */
el.pStage.addEventListener('click', togglePrompter);

window.addEventListener('resize', () => {
  if (!el.prompter.classList.contains('hidden')) measurePrompter();
});

const PROMPTER_KEYS = [
  ' ', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End',
  '[', ']', '【', '】', '+', '=', '-', 'r', 'R', 'm', 'M', 'c', 'C', 'Escape',
];

document.addEventListener('keydown', (e) => {
  if (el.prompter.classList.contains('hidden')) return;
  if (!PROMPTER_KEYS.includes(e.key)) return;
  e.preventDefault();

  const page = Math.round(el.pStage.clientHeight * 0.8);
  switch (e.key) {
    // 上下键直接挪画面：念快了往回一点，念慢了往前赶一点
    case 'ArrowUp': nudge(-lineStep()); break;
    case 'ArrowDown': nudge(lineStep()); break;
    case 'PageUp': nudge(-page); break;
    case 'PageDown': nudge(page); break;
    case 'Home': nudge(-prompter.max); break;
    case 'End': nudge(prompter.max); break;

    // 速度挪到中括号上，腾出上下键
    case '[': case '【': bump('speed', -5, 10, 200); break;
    case ']': case '】': bump('speed', 5, 10, 200); break;

    case ' ': togglePrompter(); break;
    case '+': case '=': bump('size', 4, 20, 96); break;
    case '-': bump('size', -4, 20, 96); break;
    case 'r': case 'R': resetPrompter(); break;
    case 'm': case 'M': el.pMirror.click(); break;
    case 'c': case 'C': el.pCues.click(); break;
    case 'Escape': closePrompter(); break;
    default: break;
  }
});

/* 滚轮也能挪，录制时手边有鼠标就不用找键盘 */
el.pStage.addEventListener('wheel', (e) => {
  e.preventDefault();
  nudge(e.deltaY);
}, { passive: false });

/* 后台任务做完：转写总评或测评好了，刷新口播记录（发起的人可能已经切走了，这里兜底） */
window.addEventListener('cw-job-done', (e) => {
  const job = e.detail;
  if (!['speak', 'pronounce', 'appearance'].includes(job.kind)) return;
  if (state.draft && state.mode === 'cue') loadDraftSpeaks();
  if (state.historyMode === 'speaks') loadSpeakHistory();
});
