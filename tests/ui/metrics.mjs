// 发布数据多次回填：历次记录、同一天覆盖、删除、复盘里的走势
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
const menu = async (act) => { await page.click('#confirmBtn'); await page.click(`#confirmMenu [data-act="${act}"]`); };
const day = (n) => { const d = new Date(Date.now() + n * 86400000); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

await step('注册 → 成稿', async () => {
  await page.goto(B + '/app');
  await page.click('#authTabs [data-mode="register"]');
  await page.fill('#authForm [name=username]', 'mt' + Date.now().toString(36));
  await page.fill('#authForm [name=password]', 'secret123');
  await page.click('#authSubmit');
  await page.waitForSelector('#app:not(.hidden)');
  if (await page.isVisible('#onboardBtn')) await page.click('#onboardBtn'); else await page.click('#newPersonaBtn');
  await page.fill('#personaForm [name=name]', '数据测试号');
  await page.click('#personaSaveBtn');
  await page.waitForTimeout(600);
  if (await page.isVisible('#personaCloseBtn')) await page.click('#personaCloseBtn').catch(() => {});
  await page.fill('#briefForm [name=subject]', '周末备菜');
  await page.click('#topicsBtn');
  await page.waitForSelector('#topics [data-index="0"]');
  await page.click('#topics [data-index="0"]');
  await page.waitForFunction(() => document.querySelector('#content')?.textContent.length > 100 && !document.querySelector('#content .cursor'), null, { timeout: 15000 });
});
await step('第 1 天回填', async () => {
  await menu('metrics');
  await page.waitForSelector('#metricsModal:not(.hidden) [data-metric="views"]');
  await page.fill('#metricsDate', day(-7));
  await page.fill('#metricsOn', day(-6));
  await page.dispatchEvent('#metricsOn', 'change');
  await page.fill('[data-metric="views"]', '1200');
  await page.fill('[data-metric="likes"]', '30');
  await page.click('#metricsSave');
  await page.waitForSelector('#metricsModal.hidden', { state: 'attached' });
});
await step('今天（第 7 天）再填一次，占位里有上次的数', async () => {
  await menu('metrics');
  await page.waitForSelector('#metricsModal:not(.hidden) .metrics-snap');
  const ph = await page.getAttribute('[data-metric="views"]', 'placeholder');
  await page.fill('[data-metric="views"]', '5400');
  await page.click('#metricsSave');
  await page.waitForSelector('#metricsModal.hidden', { state: 'attached' });
  return ph;
});
await step('同一天再填是改，不是多一条', async () => {
  await menu('metrics');
  await page.waitForSelector('#metricsModal:not(.hidden) .metrics-snap');
  const before = await page.inputValue('[data-metric="views"]');
  await page.fill('[data-metric="views"]', '5600');
  await page.click('#metricsSave');
  await page.waitForSelector('#metricsModal.hidden', { state: 'attached' });
  await menu('metrics');
  await page.waitForSelector('#metricsModal:not(.hidden) .metrics-snap');
  if (shot) await page.screenshot({ path: shot + '-modal.png' });
  const rows = await page.$$eval('.metrics-snap', (rs) => rs.map((r) => r.textContent.replace(/\s+/g, ' ').trim()));
  return `带出 ${before}；${rows.length} 条：${rows.join(' | ')}`;
});
await step('复盘里的走势', async () => {
  await page.click('#insightsLink');
  await page.waitForSelector('#insightsModal:not(.hidden) .ins-trend');
  if (shot) await page.screenshot({ path: shot + '-insights.png' });
  return await page.textContent('.ins-trend');
});
await step('删掉一次', async () => {
  await page.click('#insightsClose');
  await menu('metrics');
  await page.waitForSelector('#metricsModal:not(.hidden) .metrics-snap');
  await page.click('.metrics-snap:last-child [data-metric-del]');
  await page.waitForFunction(() => document.querySelectorAll('.metrics-snap').length === 1);
  return 'ok';
});
console.log(log.join('\n'));
console.log('ERRORS', errors.length ? '\n' + errors.join('\n') : 'none');
await browser.close();
