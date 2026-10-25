// 表格（粘 Markdown / 粘网页表格 / 工具条插入 / 以前粘坏的自动认回 / 阅读区画成表格）和三处「停止」（成稿、划词浮层、AI 对话）
import { chromium } from 'playwright';
import { editorDoc } from './_rich.mjs';
const B = process.argv[2];
const shot = process.argv[3];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.setDefaultTimeout(10000);
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|aborted/i.test(m.text())) errors.push(`console: ${m.text()}`); });
const log = [];
const step = async (name, fn) => {
  try { const r = await fn(); log.push(`ok   ${name}${r !== undefined ? ` → ${r}` : ''}`); }
  catch (e) { log.push(`FAIL ${name}: ${e.message.split('\n')[0]}`); }
};
const toast = (re) => page.waitForFunction((src) => new RegExp(src).test(document.querySelector('#toast')?.textContent || ''), re.source);
/* 让某个接口晚 2 秒才真正发出去：这期间界面处在「进行中」，好点「停止」 */
const slow = async (glob) => page.route(glob, async (route) => {
  await new Promise((r) => setTimeout(r, 2000));
  try { await route.continue(); } catch { /* 已经被前端取消 */ }
});
const MD = '| 提升层面 | 降本提效 | 增收体验 |\n| --- | --- | --- |\n| **效率**：更快 | 自动录单 | 缩短收货 |\n| 体验 | 减少催料 | 改善协同 |';
const BROKEN = MD.split('\n').join('\n\n');

await step('注册 → 成稿', async () => {
  await page.goto(B + '/app');
  await page.click('#authTabs [data-mode="register"]');
  await page.fill('#authForm [name=username]', 'tb' + Date.now().toString(36));
  await page.fill('#authForm [name=password]', 'secret123');
  await page.click('#authSubmit');
  await page.click('#skipOnboardBtn');
  await page.fill('#briefForm [name=subject]', '周末备菜');
  await page.click('#topicsBtn');
  await page.click('#topics [data-index="0"]');
  await page.waitForFunction(() => document.querySelector('#content')?.textContent.length > 100 && !document.querySelector('#content .cursor'), null, { timeout: 15000 });
  return (await page.textContent('#counter')).trim();
});

await step('编辑器里粘 Markdown 表格 → 变成真表格；存下来是标准表格（行间没有空行）', async () => {
  await page.click('#editBtn');
  await page.waitForSelector('#editor .ProseMirror', { state: 'visible' });
  await page.$eval('#editor', (el) => el._rich.setSelection(el._rich.getDoc().length, el._rich.getDoc().length));
  await page.$eval('#editor .ProseMirror', (el, md) => {
    const dt = new DataTransfer();
    dt.setData('text/plain', md);
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, MD);
  await page.waitForSelector('#editor table');
  const cells = await page.$$eval('#editor table th, #editor table td', (els) => els.length);
  const doc = await editorDoc(page);
  if (!doc.includes(MD)) throw new Error(`存下来的不是标准表格：${doc.slice(-200)}`);
  return `${cells} 个单元格`;
});

await step('粘网页 / Notion 里复制的表格（HTML）也认；工具条能插入、加行、删表', async () => {
  const before = await page.$$eval('#editor table', (els) => els.length);
  // 光标放到第一段末尾（不在表格里），再粘
  await page.$eval('#editor', (el) => { const d = el._rich.getDoc(); const at = d.indexOf('\n\n', d.indexOf('\n\n') + 2); el._rich.setSelection(at, at); });
  await page.$eval('#editor .ProseMirror', (el) => {
    const dt = new DataTransfer();
    dt.setData('text/html', '<table><tr><th>指标</th><th>目标</th></tr><tr><td>阅读</td><td>1万</td></tr></table>');
    dt.setData('text/plain', '指标\t目标\n阅读\t1万');
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  await page.waitForFunction((n) => document.querySelectorAll('#editor table').length > n, before);
  const doc = await editorDoc(page);
  if (!/\| 指标 \| 目标 \|\n\| --- \| --- \|\n\| 阅读 \| 1万 \|/.test(doc)) throw new Error(`网页表格没存成标准表格：${doc.slice(-160)}`);
  // 光标在表格里：加一行、再删掉整张表
  await page.locator('#editor table').first().locator('td').first().click();
  await page.click('#rtTable');
  await page.click('#rtTableMenu [data-op="rowAfter"]');
  const rows = await page.locator('#editor table').first().locator('tr').count();
  await page.locator('#editor table').first().locator('td').first().click();
  await page.click('#rtTable');
  await page.click('#rtTableMenu [data-op="delTable"]');
  await page.waitForFunction((n) => document.querySelectorAll('#editor table').length === n, before);
  // 插入一张空表
  await page.click('#rtTable');
  await page.click('#rtTableMenu [data-op="table"]');
  await page.waitForFunction((n) => document.querySelectorAll('#editor table').length === n + 1, before);
  const empty = await page.$$eval('#editor table', (els) => els.length);
  await page.click('#rtTable');
  await page.click('#rtTableMenu [data-op="delTable"]');
  return `网页表格加行后 ${rows} 行｜插入后共 ${empty} 张表`;
});

await step('以前粘坏的表格（行间有空行）：打开时自动认回；阅读区画成表格', async () => {
  const cur = await editorDoc(page);
  // 塞进一份粘坏的正文（setEditorDoc 会等正文原样相等，这里正文会被纠正，所以直接调桥）
  await page.$eval('#editor', (el, t) => el._rich.setDoc(t), cur.replace(MD, BROKEN));
  await page.waitForSelector('#editor table');
  await page.click('#saveBtn');
  await page.waitForFunction(() => /已保存/.test(document.querySelector('#saveState')?.textContent || ''));
  const doc = await editorDoc(page);
  if (!doc.includes(MD)) throw new Error(`没认回成表格：${JSON.stringify(doc.slice(doc.indexOf('| 提升') - 20, doc.indexOf('| 提升') + 260))}`);
  await page.click('#backReadBtn');
  await page.waitForSelector('#content table');
  const th = await page.$$eval('#content th', (els) => els.map((e) => e.textContent.trim()));
  const bold = await page.$eval('#content td strong', (e) => e.textContent.trim());
  if (shot) await page.screenshot({ path: `${shot}/table-read.png` });
  return `表头：${th.join('、')}｜单元格加粗：${bold}`;
});

await step('划词浮层：生成中「重来一次」换成「停止」，点了保留已写的、标已停止', async () => {
  await slow('**/api/drafts/*/assist');
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
  await page.click('#selMenu [data-action="expand"]');
  await page.waitForSelector('#assistStop');
  if (await page.$('#assistRetry')) throw new Error('生成中不该有「重来一次」');
  await page.click('#assistStop');
  await page.waitForSelector('#assistPop .assist-stopped');
  await page.waitForSelector('#assistRetry');
  await page.unroute('**/api/drafts/*/assist');
  await page.click('#assistClose');
  return '停止 → 已停止，重来一次回来了';
});

await step('流式成稿：工具条出现「停止」，点了原稿不动', async () => {
  const before = await page.textContent('#content');
  await slow('**/api/drafts/*/content');
  const at = async (label, fn) => { try { await fn(); } catch (e) { throw new Error(`${label}：${e.message.split('\n')[0]}`); } };
  await at('换方向', () => page.click('#contentCard .step-back'));
  await at('选方向', () => page.click('#topics [data-index="1"]'));
  await at('等停止按钮', () => page.waitForSelector('#streamStopBtn'));
  await at('点停止', () => page.click('#streamStopBtn'));
  await toast(/已停止/);
  await page.unroute('**/api/drafts/*/content');
  await page.waitForFunction((b) => document.querySelector('#content')?.textContent === b, before, { timeout: 8000 });
  return '已停止，原来那版还在';
});

await step('AI 对话：回答时「发送」变成「停止」，点了标已停止；之后照常能发', async () => {
  await page.click('#chatBtn');
  await page.waitForSelector('#chatPane');
  await slow('**/api/drafts/*/chat');
  await page.fill('#chatInput', '这篇主线清楚吗？');
  await page.press('#chatInput', 'Enter');
  await page.waitForSelector('#chatStopBtn');
  if (await page.$('#chatSendBtn')) throw new Error('回答时不该还有「发送」');
  await page.click('#chatStopBtn');
  await page.waitForSelector('#chatLog [data-stopped]');
  await page.waitForSelector('#chatSendBtn');
  await page.unroute('**/api/drafts/*/chat');
  await page.fill('#chatInput', '再问一次主线清楚吗？');
  await page.press('#chatInput', 'Enter');
  await page.waitForFunction(() => {
    const last = document.querySelector('#chatLog .chat-msg.assistant:last-child');
    return last && !last.querySelector('.chat-thinking') && last.querySelector('.chat-reply');
  });
  return (await page.textContent('#chatLog [data-stopped]')).trim();
});

console.log(log.join('\n'));
console.log('ERRORS', errors.length ? '\n' + errors.join('\n') : 'none');
await browser.close();
