/* TipTap 改完后：编辑区相关按钮逐个点一遍，确认没挂 */
import { chromium } from 'playwright';
import { editorDoc, selectEditor, setEditorDoc } from './_rich.mjs';

const B = process.argv[2];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.setDefaultTimeout(12000);
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
const log = [];
const step = async (name, fn) => {
  try { const r = await fn(); log.push(`ok   ${name}${r !== undefined ? ` → ${r}` : ''}`); }
  catch (e) { log.push(`FAIL ${name}: ${e.message.split('\n')[0]}`); }
};

await step('准备：注册 → 成稿 → 进编辑', async () => {
  await page.goto(B + '/app');
  await page.click('#authTabs [data-mode="register"]');
  await page.fill('#authForm [name=username]', 'rb' + Date.now().toString(36));
  await page.fill('#authForm [name=password]', 'secret123');
  await page.click('#authSubmit');
  await page.waitForSelector('#app:not(.hidden)');
  const id = await page.evaluate(async () => {
    const r = await fetch('/api/drafts/topics', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subject: '按钮回归', platform: 'gongzhonghao', tone: '实用干货', length: 800 }),
    });
    const { draft } = await r.json();
    await fetch(`/api/drafts/${draft.id}/content`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: '# 标题行\n\n第一段可以拿来划词改写。\n\n第二段留着测斜杠续写。\n\n第三段测保存。' }),
    });
    return draft.id;
  });
  await page.reload();
  await page.waitForSelector(`#history .history-item[data-id="${id}"]`);
  await page.click(`#history .history-item[data-id="${id}"]`);
  await page.click('#editBtn');
  await page.waitForSelector('#editor .ProseMirror', { state: 'visible' });
  await page.waitForSelector('.rich-toolbar');
});

await step('工具条：加粗 / 标题 / 列表 / 引用', async () => {
  // 选一段中间的字，避免划词菜单盖在工具条上
  const base = await editorDoc(page);
  const at = Math.max(0, base.indexOf('第一段'));
  await selectEditor(page, at, at + 3);
  await page.click('#rtBold');
  let doc = await editorDoc(page);
  if (!/\*\*/.test(doc) && !await page.$('#rtBold.on')) throw new Error('加粗没反应');
  await page.click('#rtHeading');
  await page.click('#rtList');
  await page.click('#rtQuote');
  doc = await editorDoc(page);
  return `len=${doc.length}`;
});

await step('工具条：字色', async () => {
  const base = await editorDoc(page);
  const at = Math.max(0, base.indexOf('第一段'));
  await selectEditor(page, at, at + 3);
  // 模拟点颜色板：先 mousedown 保住选区，再改色
  await page.$eval('#rtColor', (lab) => lab.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true })));
  await page.$eval('#rtColor input', (inp) => {
    inp.value = '#AB1234';
    inp.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(150);
  const doc = await editorDoc(page);
  if (!/color:#AB1234/i.test(doc)) throw new Error(`颜色没写入：${doc.slice(0, 120)}`);
  return '颜色已写入';
});

await step('底栏「此处放图片」点一下插入 IMAGE_MARK', async () => {
  const before = await editorDoc(page);
  await page.click('#markBtn');
  await page.waitForTimeout(150);
  const after = await editorDoc(page);
  if (!after.includes('<此处放图片>')) throw new Error('标记没插进去');
  if (after.length <= before.length) throw new Error('正文长度没增加');
  return '已插入';
});

await step('工具条「放图标记」', async () => {
  await page.click('#rtMark');
  await page.waitForTimeout(100);
  const doc = await editorDoc(page);
  const n = doc.split('<此处放图片>').length - 1;
  if (n < 2) throw new Error(`标记只有 ${n} 处`);
  return `${n} 处`;
});

await step('全屏编辑 / 退出', async () => {
  const next = await page.$eval('#modeNow', (el) => el.nextElementSibling?.id);
  if (next !== 'rtFullscreen') throw new Error('全屏按钮应在当前模式后面');
  await page.click('#rtFullscreen');
  await page.waitForSelector('#workMain.edit-fs');
  if (!(await page.$eval('body', (b) => b.classList.contains('edit-fs-on')))) throw new Error('body 没挂 edit-fs-on');
  await page.click('#rtFullscreen');
  await page.waitForFunction(() => !document.querySelector('#workMain.edit-fs'));
  return '全屏开关正常';
});

await step('保存按钮', async () => {
  await page.click('#saveBtn');
  await page.waitForFunction(() => /已保存/.test(document.querySelector('#saveState')?.textContent || ''), null, { timeout: 8000 });
  return (await page.textContent('#saveState')).trim();
});

await step('划词菜单：只有改写，没有格式条', async () => {
  const doc = await editorDoc(page);
  const at = doc.indexOf('第二段');
  if (at < 0) throw new Error('找不到第二段');
  await selectEditor(page, at, at + 3);
  if (await page.$('#selMenu:not(.hidden)')) throw new Error('划词不该自动弹出改写');
  await page.click('#rewriteBtn');
  await page.waitForSelector('#selMenu:not(.hidden)');
  for (const key of ['expand', 'shorten', 'humanize']) {
    if (!(await page.$(`#selMenu [data-action="${key}"]`))) throw new Error(`缺 ${key}`);
  }
  if (await page.$('#selMenu [data-fmt]')) throw new Error('改写菜单不该带格式按钮');
  if (!(await page.$('#selCustomBtn'))) throw new Error('缺按意见改');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(50);
  return '只有改写';
});

await step('斜杠续写菜单', async () => {
  // 用偏移定位到文末，避免 Ctrl+End 在 contenteditable 里误选全文被 / 覆盖
  const len = (await editorDoc(page)).length;
  await selectEditor(page, len, len);
  await page.keyboard.type('\n/');
  await page.waitForSelector('#slashMenu:not(.hidden)');
  for (const key of ['continue', 'opening', 'heading', 'ending']) {
    if (!(await page.$(`#slashItems [data-compose="${key}"]`))) throw new Error(`缺 ${key}`);
  }
  await page.keyboard.press('Escape');
  // 去掉试出来的斜杠，避免污染正文
  const cur = await editorDoc(page);
  if (cur.endsWith('/') || cur.endsWith('／')) {
    await setEditorDoc(page, cur.replace(/[/／]$/, ''));
  }
  return '斜杠菜单齐全';
});

await step('返回阅读 → 再修改', async () => {
  await page.click('#backReadBtn');
  await page.waitForSelector('#content', { state: 'visible' });
  await page.waitForSelector('#editBtn', { state: 'visible' });
  const readText = await page.textContent('#content');
  if (!readText.includes('第一段')) throw new Error(`阅读区也丢了：${readText.slice(0, 40)}`);
  await page.click('#editBtn');
  await page.waitForSelector('#editor .ProseMirror', { state: 'visible' });
  const doc = await editorDoc(page);
  if (!doc.includes('第一段')) throw new Error(`再进编辑正文丢了：${doc.slice(0, 80)}`);
  return `恢复 ${doc.length} 字`;
});

await step('按意见重写按钮能打开表单', async () => {
  await page.click('#reviseBtn');
  await page.waitForSelector('.ask [data-k="notes"]');
  await page.click('.ask [data-no], .ask .ask-cancel, .ask button:has-text("取消")').catch(async () => {
    await page.keyboard.press('Escape');
  });
  await page.waitForTimeout(200);
  return '表单可开';
});

await step('检查按钮', async () => {
  await page.click('#reviewBtn');
  await page.waitForFunction(() => {
    const t = document.querySelector('#reviewVerdict')?.textContent || '';
    return t && !/检查中/.test(t);
  }, null, { timeout: 15000 });
  return ((await page.textContent('#reviewVerdict')) || '').trim().slice(0, 40);
});

await step('导出菜单各格式入口', async () => {
  if (await page.isVisible('#backReadBtn')) await page.click('#backReadBtn');
  const placed = await page.$eval('.toolbar', (bar) => {
    const ids = (sel) => [...bar.querySelectorAll(`${sel} button`)].map((b) => b.id).filter(Boolean);
    const at = (list, id) => list.indexOf(id);
    const edit = ids('[data-group="edit"]');
    const craft = ids('[data-group="craft"]');
    return at(edit, 'exportBtn') < at(edit, 'metricsBtn') && at(edit, 'metricsBtn') < at(edit, 'archiveBtn')
      && at(craft, 'rewriteBtn') < at(craft, 'reviseBtn') && at(craft, 'reviseBtn') < at(craft, 'reviewBtn');
  });
  if (!placed) throw new Error('导出应在改稿行；按意见重写和检查应在改写后面');
  if (await page.$('[data-group="wrap"]')) throw new Error('不该再有单独的收尾行');
  await page.click('#exportBtn');
  await page.waitForSelector('#exportMenu');
  for (const fmt of ['copy', 'md', 'html', 'docx', 'pdf']) {
    if (!(await page.$(`#exportMenu [data-fmt="${fmt}"]`))) throw new Error(`缺导出 ${fmt}`);
  }
  await page.keyboard.press('Escape');
  return '导出齐全';
});

await step('多平台 / 配图 / 口播 / 起标题 按钮可点', async () => {
  for (const id of ['#titlesBtn', '#multiBtn', '#illusBtn', '#cuesBtn']) {
    const dis = await page.$eval(id, (b) => b.disabled);
    if (dis && id !== '#cuesBtn') throw new Error(`${id} 被禁用了`);
    await page.$(id);
  }
  return '加工组按钮在';
});

await step('语音改稿按钮在（不真开麦）', async () => {
  await page.click('#editBtn');
  await page.waitForSelector('#voiceBtn', { state: 'visible' });
  const label = (await page.textContent('#voiceBtn')).trim();
  if (!/语音改稿|说完了|识别中/.test(label)) throw new Error(label);
  return label;
});

await step('版本切换后编辑框跟着换', async () => {
  if (await page.isVisible('#backReadBtn')) await page.click('#backReadBtn');
  await page.click('#multiBtn');
  await page.waitForSelector('#multiBar');
  const boxes = await page.$$('#multiPick input');
  for (const [i, b] of boxes.entries()) { if (i > 0 && await b.isChecked()) await b.uncheck(); }
  if (boxes[0] && !(await boxes[0].isChecked())) await boxes[0].check();
  await page.click('#multiRunBtn');
  await page.waitForSelector('#verTabs button[data-ver]:not([data-ver=""])', { timeout: 15000 });
  const ver = await page.$eval('#verTabs button[data-ver]:not([data-ver=""])', (b) => b.dataset.ver);
  await page.click(`#verTabs button[data-ver="${ver}"]`);
  await page.click('#editBtn');
  await page.waitForSelector('#editor .ProseMirror');
  await setEditorDoc(page, '平台版手改一句。');
  await page.click('#saveBtn');
  await page.waitForFunction(() => /已保存/.test(document.querySelector('#saveState')?.textContent || ''));
  await page.click('#verTabs button[data-ver=""]');
  const main = await editorDoc(page);
  if (main === '平台版手改一句。') throw new Error('原文被平台版覆盖了');
  return ver;
});

console.log(log.join('\n'));
console.log('ERRORS', errors.length ? `\n${errors.join('\n')}` : 'none');
await browser.close();
const failed = log.filter((l) => l.startsWith('FAIL')).length;
process.exit(failed ? 1 : 0);
