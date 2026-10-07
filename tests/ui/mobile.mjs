// 手机浏览器（390 宽）：侧栏是「创作记录 / 账号」两个页签，创作记录一打开就看得到；点开一篇滚到正文，口播面板也在
import { chromium } from 'playwright';
const B = process.argv[2];
const shot = process.argv[3];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
page.setDefaultTimeout(10000);
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
const log = [];
const step = async (name, fn) => {
  try { const r = await fn(); log.push(`ok   ${name}${r !== undefined ? ` → ${r}` : ''}`); }
  catch (e) { log.push(`FAIL ${name}: ${e.message.split('\n')[0]}`); }
};

await step('注册，造一篇成稿（带口播提示）', async () => {
  await page.goto(B + '/app');
  await page.click('#authTabs [data-mode="register"]');
  await page.fill('#authForm [name=username]', 'mb' + Date.now().toString(36));
  await page.fill('#authForm [name=password]', 'secret123');
  await page.click('#authSubmit');
  await page.waitForSelector('#app:not(.hidden)');
  await page.evaluate(async () => {
    const post = async (url, body) => {
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      return url.endsWith('/content') ? r.text() : r.json();
    };
    const { draft } = await post('/api/drafts/topics', { subject: '周末备菜', platform: 'gongzhonghao', tone: '实用干货', length: 600 });
    await post(`/api/drafts/${draft.id}/content`, { index: 0 });
    await post(`/api/drafts/${draft.id}/cues`, {});
  });
  await page.reload();
  await page.waitForSelector('#app:not(.hidden)');
});

await step('侧栏默认是创作记录页签：记录直接可见，账号列表收着', async () => {
  await page.waitForSelector('#sideMTabs [data-mtab="history"].on');
  await page.waitForSelector('#history .history-item', { state: 'visible' });
  if (await page.isVisible('#personaList')) throw new Error('账号列表没收起来');
  const top = await page.$eval('#history .history-item', (n) => n.getBoundingClientRect().top);
  if (top > 844) throw new Error(`创作记录在首屏以外（top=${Math.round(top)}）`);
  return `第一条在 ${Math.round(top)}px`;
});

await step('点开一篇：滚到正文，正文和口播面板都在', async () => {
  await page.click('#history .history-item');
  await page.waitForFunction(() => document.querySelector('#content')?.textContent.length > 50);
  await page.waitForFunction(() => {
    const r = document.querySelector('#contentCard')?.getBoundingClientRect();
    return r && r.top < 300 && r.bottom > 0;
  }, null, { timeout: 5000 });
  await page.waitForSelector('#workSide [data-side="prompter"]', { state: 'attached' });
  await page.waitForSelector('#workSide [data-side="copyCues"]', { state: 'attached' });
  const wide = await page.evaluate(() => document.documentElement.scrollWidth);
  if (wide > 400) throw new Error(`页面横向撑出 ${wide}px`);
  if (shot) await page.screenshot({ path: shot + '.png' });
  return 'ok';
});

await step('切到账号页签：能选号，选完回到创作记录', async () => {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.click('#sideMTabs [data-mtab="account"]');
  await page.waitForSelector('#personaList', { state: 'visible' });
  if (await page.isVisible('#history')) throw new Error('创作记录没收起来');
  await page.click('#personaList [data-persona=""]');
  await page.waitForSelector('#sideMTabs [data-mtab="history"].on');
  return 'ok';
});

console.log(log.join('\n'));
console.log('ERRORS', errors.length ? '\n' + errors.join('\n') : 'none');
await browser.close();
