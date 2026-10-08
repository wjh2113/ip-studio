// 独立页面：落地页（价格从服务端取）、营销页、提示词说明书、管理后台（首次设置、各分区、A/B 变体、Eval 用例）
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

await step('未登录访问 / → 落地页，价格从服务端来', async () => {
  await page.goto(B + '/');
  await page.waitForSelector('#lpPrice .lp-plan');
  if (shot) await page.screenshot({ path: shot + '-landing.png' });
  return `${await page.title()}｜${(await page.$$('#lpPrice .lp-plan')).length} 档`;
});
await step('落地页「登录」进 /app，不再绕回落地页', async () => {
  const href = await page.getAttribute('.lp-nav a.lp-link.strong', 'href');
  if (href !== '/app') throw new Error(`导航登录链到 ${href}，应为 /app`);
  await page.click('.lp-nav a.lp-link.strong');
  await page.waitForSelector('#authScreen:not(.hidden), #authForm');
  return `href=${href}｜出现登录表单`;
});
await step('/start 营销页，投放参数带到登录链接上', async () => {
  await page.goto(B + '/start?utm_source=wx');
  await page.waitForSelector('.pm-nav');
  const hrefs = await page.$$eval('a[href*="utm_source=wx"]', (as) => as.map((a) => a.getAttribute('href')));
  return `${await page.title()}｜${hrefs.length} 个链接带上了来源`;
});
await step('/prompts 说明书：目录和条目（未登录管理员时只读）', async () => {
  await page.goto(B + '/prompts');
  await page.waitForSelector('#list .pd');
  await page.waitForSelector('#promptLock, #promptAdminLogin');
  return `${(await page.$$('#nav a')).length} 个目录项｜${(await page.$$('#list .pd')).length} 条｜锁=${await page.isVisible('#promptLock')}`;
});
await step('/admin 首次设置管理员（或登录）→ 进后台', async () => {
  await page.goto(B + '/admin');
  await page.waitForSelector('#gate:not(.hidden)');
  const sub = (await page.textContent('#gateSub')).trim();
  if (await page.isVisible('#gateForm [name=username]')) await page.fill('#gateForm [name=username]', 'boss');   // 和 quality.mjs 同一个管理员：同一轮测试共用一个库，谁先跑谁建
  await page.fill('#gateForm [name=password]', 'adminpass9');
  await page.click('#gateSubmit');
  await page.waitForSelector('#panel #stats .stat');
  return `${sub.slice(0, 16)}｜${(await page.$$('#stats .stat')).length} 个统计`;
});
await step('管理员登录后 /prompts 可编辑并保存', async () => {
  await page.goto(B + '/prompts');
  await page.waitForSelector('.docs-edit-on');
  await page.click('#list .pd details summary');
  await page.waitForSelector('.prompt-edit');
  const key = await page.getAttribute('.prompt-edit', 'data-prompt');
  const before = await page.inputValue('.prompt-edit');
  const next = `${before}\n\n（UI 测试手改）`;
  await page.fill('.prompt-edit', next);
  await page.click(`[data-save-prompt="${key}"]`);
  await page.waitForFunction(() => /已手改/.test(document.querySelector('#list')?.textContent || ''));
  return key;
});
await step('回到后台继续测分区', async () => {
  await page.goto(B + '/admin');
  await page.waitForSelector('#panel #stats .stat');
  return 'ok';
});
await step('后台各分区都能切过去', async () => {
  const keys = await page.$$eval('#adminNav [data-sec]', (bs) => bs.map((b) => b.dataset.sec));
  const seen = [];
  for (const k of keys) {
    await page.click(`#adminNav [data-sec="${k}"]`);
    await page.waitForSelector(`.admin-main > [data-sec="${k}"]:not([hidden])`);
    seen.push(k);
  }
  return seen.join(' ');
});
await step('A/B：新建一个变体', async () => {
  await page.click('#adminNav [data-sec="ab"]');
  await page.waitForSelector('#abFeature option', { state: 'attached' });
  await page.click('#abNewBtn');
  await page.fill('#abName', '测试变体');
  await page.click('#abFromBuiltin');
  await page.click('#abSave');
  await page.waitForFunction(() => /测试变体/.test(document.querySelector('#abList').textContent));
  return (await page.textContent('#abHint')).trim();
});
await step('Eval：用浮层表单加一个用例（必填没填标红）', async () => {
  await page.click('#adminNav [data-sec="eval"]');
  await page.click('#evCaseAdd');
  await page.waitForSelector('.ask [data-k="title"]');
  await page.click('.ask [data-yes]');
  const bad = await page.$eval('.ask [data-k="title"]', (n) => n.classList.contains('bad'));
  await page.fill('.ask [data-k="title"]', '测试用例');
  await page.fill('.ask [data-k="subject"]', '周末备菜');
  await page.click('.ask [data-yes]');
  await page.waitForSelector('#evCases .ev-case');
  if (shot) await page.screenshot({ path: shot + '-admin.png' });
  return `空着提交标红=${bad}｜${(await page.textContent('#evCases .ev-case b')).trim()}`;
});
await step('退出后台', async () => {
  await page.click('#logoutBtn');
  await page.waitForSelector('#gate:not(.hidden)');
  return 'ok';
});
console.log(log.join('\n'));
console.log('ERRORS', errors.length ? '\n' + errors.join('\n') : 'none');
await browser.close();
