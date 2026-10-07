// 成稿区：流式成稿、编辑保存、/ 续写、划词改写、正文历史、检查采纳、多平台版本、导出、口播提示与提词器、归档、切稿子
import { chromium } from 'playwright';
const B = process.argv[2];
const shot = process.argv[3];
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, acceptDownloads: true, permissions: ['clipboard-read', 'clipboard-write'] });
const page = await ctx.newPage();
page.setDefaultTimeout(10000);
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
const log = [];
const step = async (name, fn) => {
  try { const r = await fn(); log.push(`ok   ${name}${r !== undefined ? ` → ${r}` : ''}`); }
  catch (e) { log.push(`FAIL ${name}: ${e.message.split('\n')[0]}`); }
};
const menu = async (act) => { await page.click('#confirmBtn'); await page.click(`#confirmMenu [data-act="${act}"]`); };
const done = () => page.waitForFunction(() => document.querySelector('#content')?.textContent.length > 100 && !document.querySelector('#content .cursor'), null, { timeout: 15000 });

await step('注册 → 建号 → 成稿（流式）', async () => {
  await page.goto(B + '/app');
  await page.click('#authTabs [data-mode="register"]');
  await page.fill('#authForm [name=username]', 'ed' + Date.now().toString(36));
  await page.fill('#authForm [name=password]', 'secret123');
  await page.click('#authSubmit');
  await page.waitForSelector('#onboardBtn', { state: 'visible' });
  await page.click('#onboardBtn');
  await page.fill('#personaForm [name=name]', '成稿测试号');
  await page.click('#personaSaveBtn');
  await page.waitForFunction(() => /已创建/.test(document.querySelector('#personaSaveHint').textContent));
  await page.click('#personaCloseBtn');
  await page.fill('#briefForm [name=subject]', '周末备菜');
  await page.click('#topicsBtn');
  await page.click('#topics [data-index="0"]');
  await page.waitForSelector('#content .cursor', { timeout: 5000 }).catch(() => {});
  await done();
  await page.waitForSelector('#steps [data-step="3"].done');
  await page.waitForSelector('#reviewBox');
  return `${(await page.textContent('#contentTitle')).trim().slice(0, 20)}｜${(await page.textContent('#counter')).trim()}`;
});
await step('编辑：改字 → 自动保存；输入 / 出续写菜单 → 插入', async () => {
  await page.click('#editBtn');
  await page.waitForSelector('#editor', { state: 'visible' });
  await page.click('#editor');
  await page.keyboard.press('Control+End');
  await page.keyboard.type('\n\n补一句。');
  await page.waitForFunction(() => /已保存/.test(document.querySelector('#saveState')?.textContent || ''), null, { timeout: 8000 });
  await page.keyboard.type('\n/');
  await page.waitForSelector('#slashMenu:not(.hidden)');
  await page.click('#slashItems [data-compose="ending"]');
  await page.waitForSelector('#assistPop:not(.hidden) #assistReplace:not([disabled])', { timeout: 15000 });
  await page.click('#assistReplace');
  await page.waitForSelector('#assistPop.hidden', { state: 'attached' });
  const text = await page.inputValue('#editor');
  return `${text.includes('/') ? '斜杠没去掉' : '斜杠已去掉'}｜${text.length} 字符`;
});
await step('编辑框里划词 → 改写菜单 → 替换', async () => {
  const len = (await page.inputValue('#editor')).length;
  await page.$eval('#editor', (ta) => { ta.focus(); ta.setSelectionRange(2, 12); });
  await page.dispatchEvent('#editor', 'mouseup');
  await page.waitForSelector('#selMenu:not(.hidden)');
  await page.click('#selMenu [data-action="shorten"]');
  await page.waitForSelector('#assistPop:not(.hidden) #assistReplace:not([disabled])', { timeout: 15000 });
  const beforeAi = await page.inputValue('#editor');
  await page.click('#assistReplace');
  await page.waitForFunction((n) => document.querySelector('#editor').value.length !== n, len);
  // AI 改写后 Ctrl+Z 能撤回（浏览器自带的撤销在脚本改过正文后就断了），Ctrl+Shift+Z 再做回来
  const afterAi = await page.inputValue('#editor');
  await page.focus('#editor');
  await page.keyboard.press('Control+z');
  await page.waitForFunction((t) => document.querySelector('#editor').value === t, beforeAi);
  await page.keyboard.press('Control+Shift+z');
  await page.waitForFunction((t) => document.querySelector('#editor').value === t, afterAi);
  // 连续打的字算一步
  await page.keyboard.press('Control+End');
  await page.keyboard.type('一二三四五');
  await page.keyboard.press('Control+z');
  await page.waitForFunction((t) => document.querySelector('#editor').value === t, afterAi);
  await page.click('#saveBtn');
  await page.waitForFunction(() => /已保存/.test(document.querySelector('#saveState')?.textContent || ''));
  return 'ok';
});
await step('回到阅读 → 版本对照有存档', async () => {
  await page.click('#backReadBtn');
  await page.click('#revBtn');
  await page.waitForSelector('#revList .rev-item');
  const n = (await page.$$('#revList .rev-item')).length;
  const diff = (await page.$$('#revLeft .rev-line.diff, #revRight .rev-line.diff')).length;
  await page.click('#revClose');
  return `${n} 版，差异 ${diff} 行`;
});
await step('左右两栏收起来给正文腾地方，刷新后还记得，再展开', async () => {
  const before = await page.$eval('#contentCard .work-main', (el) => el.getBoundingClientRect().width);
  await page.click('#sideFoldBtn');
  await page.click('#workFoldBtn');
  await page.waitForSelector('#sideRail');
  await page.waitForSelector('#workRail');
  if (await page.isVisible('#history')) throw new Error('左栏没收起来');
  const after = await page.$eval('#contentCard .work-main', (el) => el.getBoundingClientRect().width);
  if (after <= before) throw new Error(`正文没变宽：${before} → ${after}`);
  await page.reload();
  await page.waitForSelector('#sideRail');
  await page.click('[data-view="library"]');
  if (await page.$('#sideRail')) throw new Error('素材库页不该收起左栏');
  await page.click('[data-view="write"]');
  await page.click('#sideExpandBtn');
  await page.click('#history .history-item');
  await page.waitForSelector('#workRail');           // 右栏收起也记住了
  await page.click('#workExpandBtn');
  await page.waitForSelector('#workSide', { state: 'visible' });
  await page.waitForSelector('#history', { state: 'visible' });
  return `正文宽 ${Math.round(before)} → ${Math.round(after)}`;
});
await step('检查 → 采纳一条', async () => {
  await menu('review');
  await page.waitForFunction(() => /没发现问题|小毛病|不通顺|检查失败/.test(document.querySelector('#reviewVerdict')?.textContent || ''), null, { timeout: 15000 });
  const btn = await page.$('#reviewList [data-apply]');
  if (btn) { await btn.click(); await page.waitForSelector('#reviewList .issue.done'); }
  return `${(await page.textContent('#reviewVerdict')).trim()}｜${btn ? '采纳了一条' : '没有可采纳的'}`;
});
await step('多平台：出一个版本 → 切过去 → 切回原文', async () => {
  await menu('multi');
  await page.waitForSelector('#multiBar');
  const boxes = await page.$$('#multiPick input');
  for (const [i, b] of boxes.entries()) { if (i > 0 && await b.isChecked()) await b.uncheck(); }
  if (!await boxes[0].isChecked()) await boxes[0].check();
  await page.click('#multiRunBtn');
  await page.waitForSelector('#verTabs button[data-ver]:not([data-ver=""])', { timeout: 15000 });
  await page.click('#verTabs button[data-ver]:not([data-ver=""])');
  const other = (await page.textContent('#verTabs .on')).trim();
  const disabled = await (async () => { await page.click('#confirmBtn'); const d = await page.$eval('#confirmMenu [data-act="cues"]', (b) => b.disabled); await page.click('#confirmBtn'); return d; })();
  await page.click('#verTabs button[data-ver=""]');
  return `${other}｜看别的版本时口播灰掉=${disabled}`;
});
await step('导出：复制、下载 Markdown', async () => {
  await page.click('#exportBtn');
  await page.click('#exportMenu [data-fmt="copy"]');
  await page.waitForFunction(() => /已复制/.test(document.querySelector('#toast')?.textContent || ''));
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  await page.click('#exportBtn');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#exportMenu [data-fmt="md"]')]);
  const { readFile } = await import('node:fs/promises');
  const body = await readFile(await dl.path(), 'utf8');
  return `剪贴板 ${clip.length} 字符｜下载 ${body.length} 字符，和复制的一样=${body === clip}`;
});
await step('口播提示 → 提词器开关、按键', async () => {
  await menu('cues');
  await page.waitForSelector('#cueList .cue', { timeout: 15000 });
  await page.click('#prompterBtn');
  await page.waitForSelector('#prompter:not(.hidden) .pseg');
  await page.keyboard.press(']');
  await page.keyboard.press('ArrowDown');
  const speed = (await page.textContent('#pSpeedVal')).trim();
  const pct = (await page.textContent('#pProgress')).trim();
  await page.keyboard.press('Escape');
  await page.waitForSelector('#prompter.hidden', { state: 'attached' });
  if (shot) await page.screenshot({ path: shot + '-cues.png' });
  return `速度 ${speed}｜进度 ${pct}｜${(await page.$$('#cueList .cue')).length} 段`;
});
await step('归档；新建 → 回到空白简报；历史里再打开落到第三步', async () => {
  await page.click('#backReadBtn');
  await menu('archive');
  await page.waitForFunction(() => /已归档/.test(document.querySelector('#toast')?.textContent || ''));
  await page.click('#historyFilter [data-arch="1"]');
  await page.waitForSelector('#history .history-item');
  await page.click('#newBtn');
  await page.waitForSelector('#briefCard', { state: 'visible' });
  const blank = await page.inputValue('#briefForm [name=subject]');
  await page.click('#history .history-item');
  await page.waitForSelector('#contentCard', { state: 'visible' });
  return `新建后题材「${blank}」｜再打开：${(await page.textContent('#contentTitle')).trim().slice(0, 16)}`;
});
console.log(log.join('\n'));
console.log('ERRORS', errors.length ? '\n' + errors.join('\n') : 'none');
await browser.close();
