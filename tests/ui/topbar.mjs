// 顶栏由 Vue 渲染：余额（数据变了自动更新，点击仍打开用量面板）；退出按钮不被挤出视口
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
const credit = () => page.$eval('#creditChip', (n) => `${n.textContent.trim()}｜hidden=${n.classList.contains('hidden')}｜low=${n.classList.contains('low')}`);

await step('登录前：余额藏着', async () => {
  await page.goto(B + '/app');
  await page.waitForSelector('#authForm');
  return await credit();
});
await step('注册后：余额由 Vue 画出来，退出按钮在视口内', async () => {
  await page.click('#authTabs [data-mode="register"]');
  await page.fill('#authForm [name=username]', 'tb' + Date.now().toString(36));
  await page.fill('#authForm [name=password]', 'secret123');
  await page.click('#authSubmit');
  await page.waitForSelector('#app:not(.hidden)');
  await page.waitForFunction(() => /剩/.test(document.querySelector('#creditChip')?.textContent || ''));
  const logout = await page.$eval('#logoutBtn', (n) => {
    const r = n.getBoundingClientRect();
    return `visible=${r.width > 0 && r.right <= window.innerWidth + 1}｜text=${n.textContent.trim()}`;
  });
  const llmGone = await page.$('.topbar-right .llm-chip') === null;
  if (!llmGone) throw new Error('模型通道芯片还在顶栏');
  return `${await credit()} ／ ${logout}`;
});
await step('升级套餐后余额跟着变（只改数据，DOM 由 Vue 更新）', async () => {
  await page.evaluate(() => fetch('/api/plan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"plan":"pro"}' }));
  await page.evaluate(() => window.dispatchEvent(new Event('cw-spent')));
  await page.waitForFunction(() => /Pro/.test(document.querySelector('#creditChip')?.textContent || ''));
  return await credit();
});
await step('点余额仍然打开用量面板', async () => {
  await page.click('#creditChip');
  await page.waitForSelector('#planModal:not(.hidden)');
  await page.click('#planClose');
  return 'ok';
});
console.log(log.join('\n'));
console.log('ERRORS', errors.length ? '\n' + errors.join('\n') : 'none');
await browser.close();
