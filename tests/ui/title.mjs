import { chromium } from 'playwright';
const B = process.argv[2];
const shot = process.argv[3];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.setDefaultTimeout(8000);
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
const log = [];
const step = async (name, fn) => {
  try { const r = await fn(); log.push(`ok   ${name}${r !== undefined ? ` → ${r}` : ''}`); }
  catch (e) { log.push(`FAIL ${name}: ${e.message.split('\n')[0]}`); }
};
await step('注册 → 建号 → 三个方向 → 成稿', async () => {
  await page.goto(B + '/app');
  await page.click('#authTabs [data-mode="register"]');
  await page.fill('#authForm [name=username]', 'tt' + Date.now().toString(36));
  await page.fill('#authForm [name=password]', 'secret123');
  await page.click('#authSubmit');
  await page.waitForSelector('#app:not(.hidden)');
  if (await page.isVisible('#onboardBtn')) await page.click('#onboardBtn'); else await page.click('#newPersonaBtn');
  await page.fill('#personaForm [name=name]', '标题测试号');
  await page.click('#personaSaveBtn');
  await page.waitForTimeout(600);
  if (await page.isVisible('#personaCloseBtn')) await page.click('#personaCloseBtn').catch(() => {});
  await page.fill('#briefForm [name=subject]', '周末备菜');
  await page.click('#topicsBtn');
  await page.waitForSelector('#topics [data-index="0"]');
  await page.click('#topics [data-index="0"]');
  await page.waitForFunction(() => document.querySelector('#content')?.textContent.length > 100 && !document.querySelector('#content .cursor'), null, { timeout: 15000 });
});
await step('确认 → 起标题', async () => {
  await page.click('#confirmBtn');
  await page.click('#confirmMenu [data-act="titles"]');
  await page.waitForSelector('#titleModal:not(.hidden) .title-row');
  return (await page.$$('.title-row')).length + ' 个候选';
});
if (shot) await page.screenshot({ path: shot + '.png' });
await step('用第二个', async () => {
  const want = (await page.textContent('.title-row:nth-child(2) b')).trim();
  await page.click('.title-row:nth-child(2) [data-title]');
  await page.waitForSelector('#titleModal.hidden', { state: 'attached' });
  const h = (await page.textContent('#contentTitle')).trim();
  const first = (await page.textContent('#content h1'))?.trim();
  return `${want === h ? '标题已替换' : `标题不一致 ${h}`}；正文 H1：${first === want ? '一致' : first}`;
});
await step('历史里多了一版', async () => {
  await page.click('#revBtn');
  await page.waitForSelector('#revList > *');
  return (await page.$$('#revList > *')).length + ' 版';
});
console.log(log.join('\n'));
console.log('ERRORS', errors.length ? '\n' + errors.join('\n') : 'none');
await browser.close();
