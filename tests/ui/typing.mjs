// 编辑框打字：页面不跳、光标不躲到吸底工具条后面（以前每打一个字，编辑框先缩回一屏高再撑开，页面被夹回顶上）
import { chromium } from 'playwright';
const B = process.argv[2];
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
const scrollY = () => page.evaluate(() => Math.round(window.scrollY));

await step('准备一篇 40 段的长稿，进编辑', async () => {
  await page.goto(B + '/app');
  await page.click('#authTabs [data-mode="register"]');
  await page.fill('#authForm [name=username]', 'typ' + Date.now().toString(36));
  await page.fill('#authForm [name=password]', 'secret123');
  await page.click('#authSubmit');
  await page.waitForSelector('#app:not(.hidden)');
  const id = await page.evaluate(async () => {
    const r = await fetch('/api/drafts/topics', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subject: '长稿打字', platform: 'gongzhonghao', tone: '实用干货', length: 1400 }) });
    const { draft } = await r.json();
    const body = Array.from({ length: 40 }, (_, i) => `第 ${i + 1} 段。一个成年人，为什么会把同一个坑踩上好几遍？这个问题开始持续地扰动我。`).join('\n\n');
    await fetch(`/api/drafts/${draft.id}/content`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: body }) });
    return draft.id;
  });
  await page.reload();
  await page.waitForSelector('#app:not(.hidden)');
  await page.click(`.history-item[data-id="${id}"]`);
  await page.click('#editBtn');
  await page.waitForSelector('#editor', { state: 'visible' });
});

await step('在中间打字：页面滚动位置不变', async () => {
  await page.$eval('#editor', (ta) => { const p = ta.value.indexOf('第 20 段'); ta.focus(); ta.setSelectionRange(p, p); });
  await page.evaluate(() => window.scrollTo(0, 1400));
  await page.waitForTimeout(100);
  const before = await scrollY();
  await page.keyboard.type('我们');
  await page.waitForTimeout(150);
  const after = await scrollY();
  if (Math.abs(after - before) > 2) throw new Error(`页面从 ${before} 跳到了 ${after}`);
  return `${before} → ${after}`;
});

await step('删掉一大段：页面不被夹回顶上', async () => {
  const before = await scrollY();
  await page.$eval('#editor', (ta) => { ta.setSelectionRange(ta.value.indexOf('第 21 段'), ta.value.indexOf('第 30 段')); });
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(150);
  const after = await scrollY();
  if (after < before - 300) throw new Error(`页面从 ${before} 跳到了 ${after}`);
  return `${before} → ${after}`;
});

await step('在屏幕底部连续回车打字：光标停在工具条上面', async () => {
  await page.$eval('#editor', (ta) => { const p = ta.value.indexOf('第 35 段'); ta.setSelectionRange(p, p); });
  for (let i = 0; i < 8; i += 1) { await page.keyboard.press('Enter'); await page.keyboard.type('新'); }
  await page.waitForTimeout(150);
  const r = await page.evaluate(() => {
    const ta = document.querySelector('#editor');
    const m = document.createElement('div');
    const cs = getComputedStyle(ta);
    for (const k of ['font', 'lineHeight', 'padding', 'border', 'whiteSpace', 'wordWrap', 'width', 'boxSizing', 'letterSpacing']) m.style[k] = cs[k];
    m.style.whiteSpace = 'pre-wrap'; m.style.position = 'absolute'; m.style.visibility = 'hidden';
    m.textContent = ta.value.slice(0, ta.selectionEnd);
    const s = document.createElement('span'); s.textContent = '.'; m.appendChild(s);
    document.body.appendChild(m);
    const caretBottom = ta.getBoundingClientRect().top + s.offsetTop + parseFloat(cs.lineHeight);
    m.remove();
    return { caretBottom: Math.round(caretBottom), barTop: Math.round(document.querySelector('#editorBar').getBoundingClientRect().top) };
  });
  if (r.caretBottom > r.barTop) throw new Error(`光标底 ${r.caretBottom} 在工具条 ${r.barTop} 下面`);
  return JSON.stringify(r);
});

console.log(log.join('\n'));
console.log('ERRORS', errors.length ? '\n' + errors.join('\n') : 'none');
await browser.close();
