/* 前端入口。各块功能在 public/js/ 下按业务拆开：
 *   core.js      全局共享：DOM 引用 el、状态 state、接口封装 api、通用小工具（转义、提示、Markdown 渲染等）
 *   auth.js      登录 / 注册
 *   account.js   账号设定、语气样本与语气档案、内容栏目
 *   brief.js     创作简报：参数继承、题材推荐、第一步三个方向
 *   compose.js   第二步流式成稿、创作记录列表
 *   export.js    复制 / 下载 / 导出
 *   editor.js    成稿编辑器：保存、划词改写、/ 续写、AI 浮层、三动作工具条、正文历史、阅读/编辑模式、语音改稿
 *   hot.js       热点板块：榜单与比对
 *   review.js    成稿检查
 *   speak.js     口播提示、口播记录与评测、提词器
 *   versions.js  多平台版本与图文配图
 *   library.js   素材库与选题池
 *   insights.js  发布数据回填与复盘
 *   plan.js      用量、套餐与支付
 *   frameworks.js 写法框架：简报里的推荐与选择、框架库的浏览与编辑
 *   titles.js    标题候选
 *   jobs.js      长任务（出图、口播转写与评测）的轮询和任务中心
 *   quickstart.js 快速建号：贴自我介绍和旧文章，先把账号设定填出来
 * 这里先按顺序加载它们（core 最先），最后启动。 */
import { api, el, esc, state, syncLength, toast } from './js/core.js';
import { enterApp } from './js/auth.js';
import './js/account.js';
import './js/brief.js';
import './js/compose.js';
import './js/export.js';
import './js/editor.js';
import './js/hot.js';
import './js/review.js';
import './js/speak.js';
import './js/versions.js';
import './js/library.js';
import './js/insights.js';
import './js/plan.js';
import './js/frameworks.js';
import './js/titles.js';
import './js/jobs.js';
import './js/quickstart.js';

/* ---------------- 启动 ---------------- */
(async function boot() {
  const [{ user }, meta] = await Promise.all([api('/me'), api('/meta')]);
  state.meta = meta;
  applyAuthMeta(meta.auth);
  // 从落地页带 ?signup=1 过来的，直接停在注册页
  if (new URLSearchParams(location.search).get('signup')) {
    document.querySelector('#authTabs [data-mode="register"]')?.click();
  }
  fillSelects(meta);
  showLlm(meta.llm);
  user ? enterApp(user) : el.auth.classList.remove('hidden');
})().catch((e) => toast(e.message));

function applyAuthMeta(auth = {}) {
  const tab = document.getElementById('registerTab');
  const invite = document.getElementById('inviteRow');
  const userRow = document.getElementById('userRow');
  const userInput = el.authForm?.username;
  if (auth.gate) {
    tab?.remove();
    el.authTabs?.classList.add('hidden');
    userRow?.classList.add('hidden');
    if (userInput) {
      userInput.removeAttribute('required');
      userInput.value = '';
    }
    const sub = document.getElementById('authSub');
    const tip = document.getElementById('authTip');
    if (sub) sub.textContent = '输入访问密码进入。与 API 网关管理台同一组密码。';
    if (tip) tip.textContent = '不开放公开注册。';
    const pw = el.authForm?.password;
    if (pw) pw.placeholder = '访问密码';
    el.authSubmit.textContent = '进入';
  } else if (auth.register === false) {
    tab?.remove();
    if (new URLSearchParams(location.search).get('signup')) {
      history.replaceState(null, '', '/');
    }
  }
  if (auth.invite && invite) {
    invite.dataset.needed = '1';
  }
}

function fillSelects({ platforms, tones }) {
  const platformOpts = platforms
    .map((p) => `<option value="${p.key}" data-length="${p.length}">${p.label}</option>`).join('');
  const toneOpts = tones
    .map((t) => `<option value="${esc(t.key)}" title="${esc(t.hint)}">${esc(t.key)}</option>`).join('');
  el.platformSel.innerHTML = platformOpts;
  el.personaPlatform.innerHTML = platformOpts;
  el.toneSel.innerHTML = toneOpts;
  el.personaTone.innerHTML = toneOpts;
  syncLength();
  el.platformSel.addEventListener('change', syncLength);
}

function showLlm(llm) {
  el.llmChip.textContent = llm.live ? `${llm.label} · ${llm.model}` : llm.label;
  el.llmChip.classList.toggle('warn', !llm.live);
  el.llmChip.title = llm.live
    ? `当前模型通道：${llm.provider} / ${llm.model}`
    : '未检测到模型密钥，当前为演示模式：流程完整，内容是本地模板。在 .env 中配置密钥后自动切换。';
}
