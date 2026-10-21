// 右栏 AI 对话：页签切换、问（不改正文）、局部改（列出改动 → 应用 → 撤销）、整篇改（先问再动手）、划词「问 AI」带引用、
// 检查结果「交给 AI 改」、话筒在、刷新后记录还在（应用状态也在）、保存天数、全屏可用、清空
import { chromium } from 'playwright';
const B = process.argv[2];
const shot = process.argv[3];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.setDefaultTimeout(10000);
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
const log = [];
const step = async (name, fn) => {
  try { const r = await fn(); log.push(`ok   ${name}${r !== undefined ? ` → ${r}` : ''}`); }
  catch (e) { log.push(`FAIL ${name}: ${e.message.split('\n')[0]}`); }
};
const body = () => page.textContent('#content');
const lastReply = '#chatLog .chat-msg.assistant:last-child';
const waitReply = () => page.waitForFunction((sel) => {
  const el = document.querySelector(sel);
  return el && !el.querySelector('.chat-thinking');
}, lastReply);

await step('注册 → 成稿', async () => {
  await page.goto(B + '/app');
  await page.click('#authTabs [data-mode="register"]');
  await page.fill('#authForm [name=username]', 'ch' + Date.now().toString(36));
  await page.fill('#authForm [name=password]', 'secret123');
  await page.click('#authSubmit');
  await page.click('#skipOnboardBtn');
  await page.fill('#briefForm [name=subject]', '周末备菜');
  await page.click('#topicsBtn');
  await page.click('#topics [data-index="0"]');
  await page.waitForFunction(() => document.querySelector('#content')?.textContent.length > 100 && !document.querySelector('#content .cursor'), null, { timeout: 15000 });
  return (await page.textContent('#counter')).trim();
});
await step('工具条「问 AI」→ 右栏切到对话，输入框拿到焦点；切回「工具」', async () => {
  await page.click('#chatBtn');
  await page.waitForSelector('#chatPane', { state: 'visible' });
  const focused = await page.evaluate(() => document.activeElement?.id);
  const wide = await page.$eval('#workSide', (el) => el.getBoundingClientRect().width);
  await page.click('#sideTabTools');
  await page.waitForSelector('#sideTools', { state: 'visible' });
  if (await page.isVisible('#chatPane')) throw new Error('切回工具后对话还在');
  await page.click('#sideTabChat');
  await page.waitForSelector('#chatPane', { state: 'visible' });
  return `焦点=${focused}｜右栏宽 ${Math.round(wide)}`;
});
await step('问一句：只回话，正文不动', async () => {
  const before = await body();
  await page.fill('#chatInput', '这篇主线清楚吗？');
  await page.press('#chatInput', 'Enter');
  await waitReply();
  const reply = (await page.textContent(`${lastReply} .chat-reply`)).trim();
  if (await page.$(`${lastReply} .chat-changes`)) throw new Error('问问题不该给改动');
  if ((await body()) !== before) throw new Error('正文被改了');
  return reply.slice(0, 24);
});
await step('要改：列出改动 → 应用写进正文 → 撤销恢复', async () => {
  const before = await body();
  await page.fill('#chatInput', '第一段改得更抓人一点');
  await page.click('#chatSendBtn');
  await waitReply();
  await page.waitForSelector(`${lastReply} .chat-edit ins`);
  if ((await body()) !== before) throw new Error('没点应用就改了正文');
  await page.click(`${lastReply} [data-act="apply"]`);
  await page.waitForFunction((b) => document.querySelector('#content').textContent !== b, before);
  if (!/演示：按你的意思改过/.test(await body())) throw new Error('改动没写进正文');
  await page.waitForSelector(`${lastReply} .chat-done`);
  await page.click(`${lastReply} [data-act="undo"]`);
  await page.waitForFunction((b) => document.querySelector('#content').textContent === b, before);
  return '应用、撤销都对';
});
await step('整篇改：先问「开始吗」，不点不动；点「开始重写」后整篇流式重写', async () => {
  const before = await body();
  await page.fill('#chatInput', '整篇换成讲故事的写法');
  await page.press('#chatInput', 'Enter');
  await waitReply();
  await page.waitForSelector(`${lastReply} [data-act="rewrite"]`);
  const notes = (await page.textContent(`${lastReply} .chat-notes`)).trim();
  if ((await body()) !== before) throw new Error('没点就改了');
  await page.click(`${lastReply} [data-act="rewrite"]`);
  await page.waitForFunction(() => /已按意见重写/.test(document.querySelector('#toast')?.textContent || ''), null, { timeout: 15000 });
  await page.waitForSelector(`${lastReply} .chat-done`);
  const diff = await page.isVisible('#reviseDiff, .revise-diff');
  await page.keyboard.press('Control+z');
  await page.waitForFunction((b) => document.querySelector('#content').textContent === b, before);
  return `意见：${notes.slice(0, 16)}｜逐段对照=${diff}`;
});
await step('划词 →「改写」→「问 AI」：带着这段做引用', async () => {
  await page.evaluate(() => {
    const p = [...document.querySelectorAll('#content p')].find((x) => x.textContent.trim().length > 12);
    const r = document.createRange();
    r.setStart(p.firstChild, 0);
    r.setEnd(p.firstChild, Math.min(10, p.firstChild.textContent.length));
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
  });
  await page.click('#rewriteBtn');
  await page.waitForSelector('#selMenu:not(.hidden)');
  await page.click('#selAskBtn');
  await page.waitForSelector('#chatQuote');
  const q = (await page.textContent('#chatQuote')).trim();
  await page.fill('#chatInput', '这段压短一点');
  await page.press('#chatInput', 'Enter');
  await waitReply();
  if (await page.isVisible('#chatQuote')) throw new Error('发完引用还挂着');
  const quoted = await page.isVisible('#chatLog .chat-quote');
  if (shot) await page.screenshot({ path: `${shot}/chat-quote.png` });
  return `${q.slice(0, 20)}｜消息里带引用=${quoted}`;
});
await step('检查结果「交给 AI 改」：切到工具 → 检查 → 点一条 → 回到对话并发出', async () => {
  await page.click('#sideTabTools');
  await page.click('#reviewBtn');
  await page.waitForFunction(() => /没发现问题|小毛病|不通顺|检查失败|风险/.test(document.querySelector('#reviewVerdict')?.textContent || ''), null, { timeout: 15000 });
  const btn = await page.$('#reviewBox [data-askai]');
  if (!btn) { await page.click('#sideTabChat'); return '这次检查没有条目（演示数据），跳过'; }
  const n = await page.$$eval('#chatLog .chat-msg', (els) => els.length).catch(() => 0);
  await btn.click();
  await page.waitForSelector('#chatPane', { state: 'visible' });
  await page.waitForFunction((k) => document.querySelectorAll('#chatLog .chat-msg').length > k, n);
  await waitReply();
  const said = (await page.textContent('#chatLog .chat-msg.user:nth-last-child(2) .chat-bubble')).trim();
  if (!/检查提示/.test(said)) throw new Error(`发出去的话不对：${said}`);
  return said.slice(0, 24);
});
await step('话筒在输入框旁（不真开麦）；保存天数可改', async () => {
  await page.waitForSelector('#chatMicBtn', { state: 'visible' });
  await page.selectOption('#chatKeepSel', '365');
  await page.waitForFunction(() => /对话记录保存 1 年/.test(document.querySelector('#toast')?.textContent || ''));
  return '话筒在｜改成 1 年';
});
await step('刷新后对话记录还在，应用过的显示「已应用」，保存天数也记住了', async () => {
  // 先应用一条局部改动，看刷新后状态在不在
  const applyBtn = await page.$('#chatLog .chat-msg.assistant [data-act="apply"]');
  if (applyBtn) { await applyBtn.click(); await page.waitForTimeout(300); }
  const count = await page.$$eval('#chatLog .chat-msg', (els) => els.length);
  await page.waitForFunction(() => /已保存/.test(document.querySelector('#saveState')?.textContent || '') || !document.querySelector('#saveState'), null, { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(1500);
  await page.reload();
  await page.click('#history .history-item');
  await page.waitForSelector('#chatPane', { state: 'visible' });
  await page.waitForFunction((k) => document.querySelectorAll('#chatLog .chat-msg').length === k, count);
  const done = await page.$$eval('#chatLog .chat-done', (els) => els.length);
  const keep = await page.inputValue('#chatKeepSel');
  if (keep !== '365') throw new Error(`保存天数没记住：${keep}`);
  if (applyBtn && !done) throw new Error('应用状态没记住');
  return `${count} 条｜已应用/已重写 ${done} 条`;
});
await step('全屏：对话栏贴在右边仍可见；清空对话（先确认）', async () => {
  await page.click('#rtFullscreen');
  await page.waitForFunction(() => document.body.classList.contains('edit-fs-on'));
  const box = await page.$eval('#workSide', (el) => { const r = el.getBoundingClientRect(); return { x: r.x, w: r.width, vis: getComputedStyle(el).display }; });
  if (box.vis === 'none' || box.x < 900) throw new Error(`全屏对话位置不对 ${JSON.stringify(box)}`);
  if (shot) await page.screenshot({ path: `${shot}/chat-fullscreen.png` });
  await page.click('#rtFullscreen');
  await page.click('#chatClearBtn');
  await page.click('.ask [data-yes]');
  await page.waitForSelector('#chatLog .chat-empty');
  await page.reload();
  await page.click('#history .history-item');
  await page.waitForSelector('#chatLog .chat-empty');
  return `x=${Math.round(box.x)} w=${Math.round(box.w)}｜清空后刷新也是空的`;
});
console.log(log.join('\n'));
console.log('ERRORS', errors.length ? '\n' + errors.join('\n') : 'none');
await browser.close();
