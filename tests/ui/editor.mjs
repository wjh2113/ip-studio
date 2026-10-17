// 成稿区：流式成稿、编辑保存、/ 续写、划词改写、正文历史、检查采纳、多平台版本、导出、口播提示与提词器、归档、切稿子
import { chromium } from 'playwright';
import { editorDoc, selectEditor } from './_rich.mjs';
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
const menu = async (act) => {
  const map = { review: '#reviewBtn', multi: '#multiBtn', illus: '#illusBtn', cues: '#cuesBtn', titles: '#titlesBtn', metrics: '#metricsBtn', archive: '#archiveBtn' };
  const sel = map[act];
  if (!sel) throw new Error('unknown act ' + act);
  await page.click(sel);
};
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
  // 成稿后不再自动检查：工具栏手动点「检查」
  await page.waitForSelector('#reviewBtn');
  return `${(await page.textContent('#contentTitle')).trim().slice(0, 20)}｜${(await page.textContent('#counter')).trim()}`;
});
await step('编辑：改字 → 自动保存；输入 / 出续写菜单 → 插入', async () => {
  await page.click('#editBtn');
  await page.waitForSelector('#editor .ProseMirror', { state: 'visible' });
  await page.click('#editor .ProseMirror');
  await page.keyboard.press('Control+End');
  await page.keyboard.type('\n\n补一句。');
  await page.waitForFunction(() => /已保存/.test(document.querySelector('#saveState')?.textContent || ''), null, { timeout: 8000 });
  await page.keyboard.type('\n/');
  await page.waitForSelector('#slashMenu:not(.hidden)');
  await page.click('#slashItems [data-compose="ending"]');
  await page.waitForSelector('#assistPop:not(.hidden) #assistReplace:not([disabled])', { timeout: 15000 });
  await page.click('#assistReplace');
  await page.waitForSelector('#assistPop.hidden', { state: 'attached' });
  const text = await editorDoc(page);
  return `${text.includes('/') ? '斜杠没去掉' : '斜杠已去掉'}｜${text.length} 字符`;
});
await step('编辑框里划词 → 改写菜单 → 替换', async () => {
  const len = (await editorDoc(page)).length;
  await selectEditor(page, 2, 12);
  if (await page.$('#selMenu:not(.hidden)')) throw new Error('划词不该自动弹出改写');
  await page.click('#rewriteBtn');
  await page.waitForSelector('#selMenu:not(.hidden)');
  await page.click('#selMenu [data-action="shorten"]');
  await page.waitForSelector('#assistPop:not(.hidden) #assistReplace:not([disabled])', { timeout: 15000 });
  const beforeAi = await editorDoc(page);
  await page.click('#assistReplace');
  await page.waitForFunction((n) => {
    const el = document.querySelector('#editor');
    return (el?.dataset?.doc ?? el?._rich?.getDoc?.() ?? '').length !== n;
  }, len);
  // AI 改写后 Ctrl+Z 能撤回，Ctrl+Shift+Z 再做回来
  const afterAi = await editorDoc(page);
  await page.click('#editor .ProseMirror');
  await page.keyboard.press('Control+z');
  await page.waitForFunction((t) => {
    const el = document.querySelector('#editor');
    return (el?.dataset?.doc ?? el?._rich?.getDoc?.() ?? '') === t;
  }, beforeAi);
  await page.keyboard.press('Control+Shift+z');
  await page.waitForFunction((t) => {
    const el = document.querySelector('#editor');
    return (el?.dataset?.doc ?? el?._rich?.getDoc?.() ?? '') === t;
  }, afterAi);
  // 连续打的字算一步
  await page.keyboard.press('Control+End');
  await page.keyboard.type('一二三四五');
  await page.keyboard.press('Control+z');
  await page.waitForFunction((t) => {
    const el = document.querySelector('#editor');
    return (el?.dataset?.doc ?? el?._rich?.getDoc?.() ?? '') === t;
  }, afterAi);
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
await step('划词写自己的意见改这段；整篇「按意见重写」→ 原稿留版本、Ctrl+Z 能退回', async () => {
  if (await page.isVisible('#editBtn')) await page.click('#editBtn');
  await page.waitForSelector('#editor .ProseMirror', { state: 'visible' });
  await selectEditor(page, 2, 12);
  await page.click('#rewriteBtn');
  await page.waitForSelector('#selMenu:not(.hidden)');
  // Vue v-model：fill 后等按钮可点，再回车提交（点 disabled 会一直等到超时）
  await page.fill('#selCustomInput', '加一个具体例子');
  await page.waitForFunction(() => !document.querySelector('#selCustomBtn')?.disabled);
  await page.press('#selCustomInput', 'Enter');
  await page.waitForSelector('#assistPop:not(.hidden) #assistReplace:not([disabled])', { timeout: 15000 });
  await page.click('#assistReplace');
  await page.waitForSelector('#assistPop.hidden', { state: 'attached' });

  const before = await editorDoc(page);
  await page.click('#reviseBtn');
  await page.waitForSelector('.ask [data-k="notes"]');
  await page.fill('.ask [data-k="notes"]', '开头直接上案例');
  await page.click('.ask [data-yes]');
  await page.waitForFunction(() => /已按意见重写/.test(document.querySelector('#toast')?.textContent || ''), null, { timeout: 15000 });
  const after = await page.textContent('#content');
  if (!/开头直接上案例/.test(after)) throw new Error('正文没换成重写后的');
  await page.keyboard.press('Control+z');
  await page.waitForFunction(() => !/开头直接上案例/.test(document.querySelector('#content')?.textContent || ''));
  return '一段按意见改 + 整篇重写 + 撤销 都行';
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
  const disabled = await page.$eval('#cuesBtn', (b) => b.disabled);
  await page.click('#verTabs button[data-ver=""]');
  return `${other}｜看别的版本时口播灰掉=${disabled}`;
});
await step('修改：版本栏切到平台版本，编辑框跟着换成那一版，改了存到那一版', async () => {
  if (await page.isVisible('#backReadBtn')) await page.click('#backReadBtn');
  await page.waitForSelector('#editBtn');
  const id = await page.$eval('#history .history-item.active', (n) => n.dataset.id);
  const ver = await page.$eval('#verTabs button[data-ver]:not([data-ver=""])', (b) => b.dataset.ver);
  await page.click(`#verTabs button[data-ver="${ver}"]`);
  await page.click('#editBtn');
  const got = async () => (await (await page.evaluate((u) => fetch(u).then((r) => r.json()), `/api/drafts/${id}`))).draft;
  const d0 = await got();
  if ((await editorDoc(page)) !== d0.variants[ver].content) throw new Error('编辑框不是这个版本的正文');
  await page.click('#editor .ProseMirror');
  await page.keyboard.press('Control+End');
  await page.keyboard.type('（手改）');
  await page.waitForFunction(() => /已保存/.test(document.body.textContent), null, { timeout: 8000 });
  const d1 = await got();
  if (!d1.variants[ver].content.endsWith('（手改）')) throw new Error('改的没存进这个版本');
  if (d1.content !== d0.content) throw new Error('原文被改了');
  await page.click('#verTabs button[data-ver=""]');
  if ((await editorDoc(page)) !== d1.content) throw new Error('切回原文，编辑框没换回来');
  await page.click('#backReadBtn');
  return ver;
});
await step('检查结果点一条：左边原文定位到那句', async () => {
  const item = await page.$('#reviewList .issue, #reviewFlags .flag.locatable, #toneBox .tone-item.locatable');
  if (!item) return '这篇没有可定位的条目';
  await item.click();
  await page.waitForTimeout(400);
  const hit = await page.evaluate(() => (window.CSS?.highlights?.has('locate') ? 'highlight' : (window.getSelection().toString() ? 'selection' : '')));
  return hit || '（没找到原句，提示已给）';
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
await step('富文本：工具条在；字色与同域图能写入正文并保存', async () => {
  // 口播结束后可能还在 cue 模式：先回阅读再进编辑
  await page.evaluate(() => {
    const back = document.querySelector('#backReadBtn');
    if (back && back.offsetParent) back.click();
  });
  await page.waitForTimeout(200);
  if (await page.isVisible('#editBtn')) await page.click('#editBtn');
  await page.waitForSelector('#editor .ProseMirror', { state: 'visible' });
  if (!(await page.$('.rich-toolbar'))) throw new Error('没有富文本工具条');
  const id = await page.$eval('#history .history-item.active', (n) => n.dataset.id);
  const png = Uint8Array.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
    0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0xde, 0x00, 0x00, 0x00,
    0x0c, 0x49, 0x44, 0x41, 0x54, 0x08, 0xd7, 0x63, 0xf8, 0xff, 0xff, 0x3f,
    0x00, 0x05, 0xfe, 0x02, 0xfe, 0xdc, 0xcc, 0x59, 0xe7, 0x00, 0x00, 0x00,
    0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
  ]);
  await page.evaluate(async ({ id, bytes }) => {
    const blob = new Blob([new Uint8Array(bytes)], { type: 'image/png' });
    const res = await fetch(`/api/drafts/${id}/assets`, {
      method: 'POST',
      headers: { 'Content-Type': 'image/png', 'X-Filename': 'ui.png' },
      body: blob,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'upload fail');
    const el = document.querySelector('#editor');
    const cur = el._rich.getDoc();
    el._rich.setDoc(`<span style="color:#CC3344">着色</span>\n\n${cur}\n\n![](${data.url})`);
  }, { id, bytes: [...png] });
  await page.click('#saveBtn');
  await page.waitForFunction(() => /已保存/.test(document.querySelector('#saveState')?.textContent || ''));
  const after = await editorDoc(page);
  if (!/color:#CC3344/i.test(after)) throw new Error('颜色没写入正文');
  if (!/\/image\/\d+\//.test(after)) throw new Error('正文里没有同域图片地址');
  if (/data:image/.test(after)) throw new Error('不应把 base64 写进正文');
  if (await page.isVisible('#backReadBtn')) await page.click('#backReadBtn');
  return '颜色/图片已落库';
});
await step('归档；新建 → 回到空白简报；历史里再打开落到第三步', async () => {
  if (await page.isVisible('#backReadBtn')) await page.click('#backReadBtn');
  await page.waitForSelector('#editBtn', { state: 'visible' });
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
