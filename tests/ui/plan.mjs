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
await step('应用内确认框：Esc 取消不动，确认才删', async () => {
  await page.evaluate(async () => {
    await fetch('/api/drafts/topics', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subject: '确认框测试', platform: 'xiaohongshu', tone: '实用干货', length: 600 }) });
  });
  await page.reload();
  await page.waitForSelector('#history .history-item');
  await page.click('#history .history-item .del');
  await page.waitForSelector('.ask [data-yes]');
  await page.keyboard.press('Escape');
  await page.waitForSelector('.ask', { state: 'detached' });
  const still = (await page.$$('#history .history-item')).length;
  await page.click('#history .history-item .del');
  await page.click('.ask [data-yes]');
  await page.waitForFunction(() => !document.querySelector('#history .history-item'));
  return `Esc 后还在 ${still} 条，确认后删掉`;
});
console.log(log.join('\n'));
console.log('ERRORS', errors.length ? '\n' + errors.join('\n') : 'none');
await browser.close();
