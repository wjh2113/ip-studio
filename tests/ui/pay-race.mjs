/* 用乱序响应复现支付通道切换竞态；在窄屏上操作真实构建页面。 */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
page.setDefaultTimeout(10000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
try {
  await page.goto(process.argv[2] + '/app');
  await page.click('#authTabs [data-mode="register"]');
  await page.fill('#authForm [name=username]', 'race' + Date.now().toString(36));
  await page.fill('#authForm [name=password]', 'secret123');
  await page.click('#authSubmit');
  await page.waitForSelector('#app:not(.hidden)');
  await page.click('#creditChip');
  await page.waitForSelector('#planCards [data-plan]');
  await page.route('**/api/pay', (route) => route.fulfill({ json: { pay: { live: false, channels: [{ key: 'wechat', label: '微信' }, { key: 'alipay', label: '支付宝' }] } } }));
  const orders = [];
  let resolveFirst;
  const first = new Promise((resolve) => { resolveFirst = resolve; });
  await page.route('**/api/pay/order', async (route) => {
    orders.push(route);
    if (orders.length === 1) { resolveFirst(); return; }
    await route.fulfill({ json: { no: `new-${orders.length}`, amount: 4900, mock: true } });
  });
  await page.click('#planCards [data-plan]');
  await first;
  await page.click('#payChannels [data-ch="alipay"]');
  await page.waitForFunction(() => document.querySelector('#payHint')?.textContent.includes('new-2'));
  const oldResponse = page.waitForResponse((res) => res.url().endsWith('/api/pay/order') && res.request().postDataJSON().channel === 'wechat');
  await orders[0].fulfill({ json: { no: 'old-order', amount: 4900, mock: true } });
  await oldResponse;
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.match(await page.textContent('#payHint'), /new-2/);
  console.log('ok   窄屏切换支付通道：旧下单响应不能覆盖新订单');

  await page.clock.install();
  let resolvePoll;
  const polled = new Promise((resolve) => { resolvePoll = resolve; });
  let heldPoll;
  let pollCount = 0;
  await page.route('**/api/pay/order/new-2', (route) => { pollCount += 1; heldPoll = route; resolvePoll(); });
  await page.clock.fastForward(3500);
  await polled;
  await page.clock.fastForward(10000);
  assert.equal(pollCount, 1, '慢查询期间不重复轮询');
  await page.click('#payChannels [data-ch="wechat"]');
  await page.waitForFunction(() => document.querySelector('#payHint')?.textContent.includes('new-3'));
  const pollResponse = page.waitForResponse('**/api/pay/order/new-2');
  await heldPoll.fulfill({ json: { order: { status: 'paid' }, quota: { left: 999 } } });
  await pollResponse;
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.match(await page.textContent('#payHint'), /new-3/);
  console.log('ok   慢轮询不重叠；旧订单到账响应不能关闭新订单');
  await page.click('#payCancel');
  assert.equal(await page.locator('#payBox').count(), 0);
  assert.deepEqual(errors, []);
  console.log('ERRORS none');
} finally { await browser.close(); }
