// 数据回流 + 线上指标：框架推荐里的「数据好」、选题提示词里的发布数据、后台「内容质量」
import { chromium } from 'playwright';
const B = process.argv[2];
const shot = process.argv[3];
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
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

await step('注册 → 建号', async () => {
  await page.goto(B + '/app');
  await page.click('#authTabs [data-mode="register"]');
  await page.fill('#authForm [name=username]', 'qa' + Date.now().toString(36));
  await page.fill('#authForm [name=password]', 'secret123');
  await page.click('#authSubmit');
  await page.waitForSelector('#app:not(.hidden)');
  if (await page.isVisible('#onboardBtn')) await page.click('#onboardBtn'); else await page.click('#newPersonaBtn');
  await page.fill('#personaForm [name=name]', '回流测试号');
  await page.click('#personaSaveBtn');
  await page.waitForTimeout(600);
  if (await page.isVisible('#personaCloseBtn')) await page.click('#personaCloseBtn').catch(() => {});
});

await step('造 6 篇带数据的稿子（3 篇用同一个内置框架，数据好）', async () => page.evaluate(async () => {
  const post = async (url, body) => {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (url.endsWith('/content')) { await r.text(); return null; }
    return r.json();
  };
  const personaId = (await (await fetch('/api/personas')).json()).personas[0].id;
  const fw = (await (await fetch('/api/frameworks')).json()).builtin.find((f) => f.key.startsWith('b:') && (!f.platforms.length || f.platforms.includes('xiaohongshu')));
  const views = [9000, 8000, 7000, 900, 800, 700];
  for (let i = 0; i < 6; i += 1) {
    const { draft } = await post('/api/drafts/topics', {
      subject: `测试题材${i}`, platform: 'xiaohongshu', tone: '轻松', length: 600, persona_id: personaId,
      framework: i < 3 ? fw.key : 'none',
    });
    await post(`/api/drafts/${draft.id}/content`, { index: 0 });
    await post(`/api/drafts/${draft.id}/metrics`, { views: views[i], published_at: '2026-09-01', captured_on: '2026-09-08' });
  }
  return fw.name;
}));

await step('简报里推荐框架带「数据好」', async () => {
  await page.reload();
  await page.waitForSelector('#app:not(.hidden)');
  await page.fill('#briefForm [name=subject]', '周末备菜');
  await page.dispatchEvent('#briefForm [name=subject]', 'change');
  await page.waitForSelector('#fwChips .n.up');
  const chip = await page.$('#fwChips .n.up');
  const btn = await chip.evaluateHandle((n) => n.closest('button'));
  return `${(await btn.textContent()).trim()}｜${await btn.getAttribute('title')}`;
});

await step('成稿 → 改一句 → 检查', async () => {
  await page.click('#topicsBtn');
  await page.waitForSelector('#topics [data-index="0"]');
  await page.click('#topics [data-index="0"]');
  await page.waitForFunction(() => document.querySelector('#content')?.textContent.length > 100 && !document.querySelector('#content .cursor'), null, { timeout: 15000 });
  await page.click('#editBtn');
  const text = await page.inputValue('#editor');
  await page.fill('#editor', text.replace(/\n\n[^\n]+\n/, '\n\n这一段我自己重写了。\n'));
  await page.click('#saveBtn');
  await page.waitForFunction(() => /已保存/.test(document.querySelector('#saveState')?.textContent || ''));
  await page.click('#backReadBtn');
  await page.click('#confirmBtn');
  await page.click('#confirmMenu [data-act="review"]');
  await page.waitForTimeout(1500);
  const d = await page.evaluate(async () => (await (await fetch(`/api/drafts?limit=1`)).json()));
  return 'ok';
});

await step('后台 → 内容质量', async () => {
  const r = await page.evaluate(async () => {
    const res = await fetch('/api/admin/setup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'boss', password: 'adminpass9' }) });
    return res.status;
  });
  await page.goto(B + '/admin');
  if (await page.isVisible('#gateForm')) {
    await page.fill('#gateForm [name=username]', 'boss').catch(() => {});
    await page.fill('#gateForm [name=password]', 'adminpass9');
    await page.click('#gateSubmit');
  }
  await page.waitForSelector('#adminNav [data-sec="quality"]');
  await page.click('#adminNav [data-sec="quality"]');
  await page.waitForSelector('#qualityTable tbody tr');
  if (shot) await page.screenshot({ path: shot + '-admin.png' });
  return `setup ${r}｜` + (await page.$$eval('#qualityTable tbody tr', (rs) => rs.map((x) => x.textContent.replace(/\s+/g, ' ').trim()))).join(' | ');
});
console.log(log.join('\n'));
console.log('ERRORS', errors.length ? '\n' + errors.join('\n') : 'none');
await browser.close();
