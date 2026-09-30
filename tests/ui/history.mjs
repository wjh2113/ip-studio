// 左侧创作记录由 Vue 渲染：列表、计数、切换筛选、归档、删除、「把已完成的收起来」、口播记录分开放
import { chromium } from 'playwright';
const B = process.argv[2];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.setDefaultTimeout(10000);
page.on('dialog', (d) => d.accept());
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
const log = [];
const step = async (name, fn) => {
  try { const r = await fn(); log.push(`ok   ${name}${r !== undefined ? ` → ${r}` : ''}`); }
  catch (e) { log.push(`FAIL ${name}: ${e.message.split('\n')[0]}`); }
};
const items = () => page.$$eval('#history .history-item', (ns) => ns.map((n) => n.querySelector('h4').textContent.trim()));
const counts = () => page.$$eval('#historyFilter button', (bs) => bs.map((b) => `${b.textContent.trim()}${b.classList.contains('on') ? '*' : ''}`).join(' '));

await step('注册，造三篇（两篇写完）', async () => {
  await page.goto(B + '/app');
  await page.click('#authTabs [data-mode="register"]');
  await page.fill('#authForm [name=username]', 'hs' + Date.now().toString(36));
  await page.fill('#authForm [name=password]', 'secret123');
  await page.click('#authSubmit');
  await page.waitForSelector('#app:not(.hidden)');
  await page.evaluate(async () => {
    const post = async (url, body) => {
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      return url.endsWith('/content') ? r.text() : r.json();
    };
    for (const [i, subject] of ['周末备菜', '通勤播客', '早起习惯'].entries()) {
      const { draft } = await post('/api/drafts/topics', { subject, platform: 'xiaohongshu', tone: '实用干货', length: 600 });
      if (i < 2) await post(`/api/drafts/${draft.id}/content`, { index: 0 });
    }
  });
  await page.reload();
  await page.waitForSelector('#app:not(.hidden)');
  await page.waitForFunction(() => document.querySelectorAll('#history .history-item').length === 3);
  return `${(await items()).length} 篇｜${await counts()}`;
});
await step('点一篇 → 高亮', async () => {
  await page.click('#history .history-item:nth-child(2)');
  await page.waitForSelector('#history .history-item.active');
  return await page.textContent('#history .history-item.active h4');
});
await step('「把已完成的收起来」→ 2 篇进归档', async () => {
  await page.waitForSelector('#historyFoot:not(.hidden)');
  const label = (await page.textContent('#archiveDoneBtn')).trim();
  await page.click('#archiveDoneBtn');
  await page.click('.ask [data-yes]').catch(() => {});
  await page.waitForFunction(() => document.querySelectorAll('#history .history-item').length === 1);
  return `${label} → 剩 ${(await items()).join('、')}｜${await counts()}`;
});
await step('切到已归档，再恢复一篇', async () => {
  await page.click('#historyFilter [data-arch="1"]');
  await page.waitForFunction(() => document.querySelectorAll('#history .history-item').length === 2);
  await page.click('#history .history-item [data-to="0"]');
  await page.waitForFunction(() => document.querySelectorAll('#history .history-item').length === 1);
  return await counts();
});
await step('口播筛选：用单独的容器，创作记录列表藏起来', async () => {
  await page.click('#historyFilter [data-view="speaks"]');
  await page.waitForFunction(() => /口播记录/.test(document.querySelector('#speakHistory')?.textContent || ''));
  const vis = await page.evaluate(() => ({
    history: getComputedStyle(document.querySelector('#history')).display,
    speak: getComputedStyle(document.querySelector('#speakHistory')).display,
    foot: document.querySelector('#historyFoot').classList.contains('hidden'),
  }));
  return JSON.stringify(vis);
});
await step('回到进行中，删掉一篇', async () => {
  await page.click('#historyFilter [data-arch="0"]');
  await page.waitForFunction(() => document.querySelectorAll('#history .history-item').length === 2);
  await page.click('#history .history-item:first-child .del');
  await page.click('.ask [data-yes]').catch(() => {});
  await page.waitForFunction(() => document.querySelectorAll('#history .history-item').length === 1);
  return `${(await items()).join('、')}｜${await counts()}`;
});
console.log(log.join('\n'));
console.log('ERRORS', errors.length ? '\n' + errors.join('\n') : 'none');
await browser.close();
