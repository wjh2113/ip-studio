// 用量面板与支付（演示支付）：打开面板、下单、模拟付款、轮询到账后套餐和余额跟着变；应用内确认框
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

await step('注册', async () => {
  await page.goto(B + '/app');
  await page.click('#authTabs [data-mode="register"]');
  await page.fill('#authForm [name=username]', 'pl' + Date.now().toString(36));
  await page.fill('#authForm [name=password]', 'secret123');
  await page.click('#authSubmit');
  await page.waitForSelector('#app:not(.hidden)');
  await page.waitForFunction(() => /剩/.test(document.querySelector('#creditChip')?.textContent || ''));
  return (await page.textContent('#creditChip')).trim();
});
await step('打开用量面板', async () => {
  await page.click('#creditChip');
  await page.waitForSelector('#planModal:not(.hidden) #planNow .big');
  const cards = await page.$$eval('#planCards .plan-card h4', (ns) => ns.map((n) => n.textContent.trim()));
  return `${(await page.textContent('#planPeriod')).trim()}｜${cards.join(' / ')}`;
});
await step('下单 → 演示支付 → 到账', async () => {
  await page.click('#planCards [data-plan]');
  await page.waitForSelector('#payBox #mockPaid');
  if (shot) await page.screenshot({ path: shot + '-pay.png' });
  const order = (await page.textContent('#payHint')).replace(/\s+/g, ' ').trim();
  await page.click('#mockPaid');
  await page.waitForSelector('#payBox', { state: 'detached', timeout: 15000 });
  await page.waitForSelector('#planCards .plan-card.on');
  const on = (await page.textContent('#planCards .plan-card.on h4')).trim();
  return `${order}｜现在是 ${on}｜顶栏 ${(await page.textContent('#creditChip')).trim()}`;
});
await step('Esc 关面板', async () => {
  await page.keyboard.press('Escape');
  await page.waitForSelector('#planModal.hidden', { state: 'attached' });
  return 'ok';
});
await step('应用内确认框：取消不动、Esc 只关确认框', async () => {
  await page.evaluate(() => { window.__r = 'pending'; window.ask.confirm({ title: '测试' }).then((v) => { window.__r = v; }); });
  await page.waitForSelector('.ask [data-yes]');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__r === false);
  await page.evaluate(() => { window.ask.form({ title: '改名', fields: [{ key: 'n', label: '名字', required: true }] }).then((v) => { window.__f = v; }); });
  await page.waitForSelector('.ask [data-k="n"]');
  await page.click('.ask [data-yes]');
  const bad = await page.$eval('.ask [data-k="n"]', (n) => n.classList.contains('bad'));
  await page.fill('.ask [data-k="n"]', '小王');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__f?.n === '小王');
  return `空着提交标红=${bad}`;
});
console.log(log.join('\n'));
console.log('ERRORS', errors.length ? '\n' + errors.join('\n') : 'none');
await browser.close();
