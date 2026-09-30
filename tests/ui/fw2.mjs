// 框架库二期：范文拆解、栏目默认框架、检查里的防洗稿
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
const SOURCE = '周末花两个小时把一周的菜备好，工作日下班十五分钟就能吃上热饭。'.repeat(8);
await step('注册建号', async () => {
  await page.goto(B + '/app');
  await page.click('#authTabs [data-mode="register"]');
  await page.fill('#authForm [name=username]', 'f2' + Date.now().toString(36));
  await page.fill('#authForm [name=password]', 'secret123');
  await page.click('#authSubmit');
  await page.waitForSelector('#app:not(.hidden)');
  if (await page.isVisible('#onboardBtn')) await page.click('#onboardBtn'); else await page.click('#newPersonaBtn');
  await page.fill('#personaForm [name=name]', '二期测试号');
  await page.click('#personaSaveBtn');
  await page.waitForTimeout(600);
  if (await page.isVisible('#personaCloseBtn')) await page.click('#personaCloseBtn').catch(() => {});
});
await step('从范文拆解 → 编辑器 → 保存', async () => {
  await page.click('#fwLibBtn');
  await page.click('#fwExtractBtn');
  await page.fill('#fwSource', SOURCE);
  await page.click('#fwExtractRun');
  await page.waitForSelector('#fwEditor:not(.hidden)');
  if (shot) await page.screenshot({ path: shot + '-extract.png' });
  const why = await page.textContent('#fwWhy');
  await page.click('#fwSave');
  await page.waitForSelector('.fw-card[data-key^="u:"]');
  const tags = await page.textContent('.fw-card[data-key^="u:"] .fw-card-head');
  return `${why.trim()}；卡片：${tags.replace(/\s+/g, ' ').trim()}`;
});
await step('栏目设默认框架（用刚拆出来的）', async () => {
  await page.click('#fwClose');
  await page.click('#manageSectionsBtn');
  await page.waitForSelector('#sectionModal:not(.hidden)');
  await page.selectOption('#sectionPreset', { index: 1 }).catch(() => {});
  await page.click('#sectionAddBtn');
  await page.waitForSelector('#sectionForm:not(.hidden)');
  await page.waitForFunction(() => document.querySelectorAll('#sectionFramework option').length > 2);
  const key = await page.$eval('#sectionFramework optgroup[label="我的"] option', (o) => o.value);
  await page.selectOption('#sectionFramework', key);
  // 栏目要求的必填素材：测试里全部清掉
  await page.$$eval('#fieldRows input[type=checkbox]', (cs) => cs.forEach((c) => { c.checked = false; }));
  await page.click('#sectionSaveBtn');
  await page.waitForSelector('#sectionForm.hidden', { state: 'attached' });
  await page.click('#sectionModalClose');
  return key;
});
await step('选这个栏目 → 自动带上默认框架', async () => {
  await page.click('#sectionChips [data-section]:not([data-section=""])');
  await page.waitForFunction(() => document.querySelector('#fwChips .on')?.dataset.fw?.startsWith('u:'));
  return await page.textContent('#fwChips .on');
});
await step('写一篇抄范文的稿子 → 检查报原创度', async () => {
  await page.fill('#briefForm [name=subject]', '周末备菜');
  await page.click('#topicsBtn');
  await page.waitForSelector('#topics [data-index="0"]');
  await page.click('#topics [data-index="0"]');
  await page.waitForFunction(() => document.querySelector('#content')?.textContent.length > 100 && !document.querySelector('#content .cursor'), null, { timeout: 15000 });
  await page.click('#editBtn');
  await page.fill('#editor', `# 周末备菜\n\n${SOURCE.slice(0, 80)}\n\n我自己的一段话。`);
  await page.click('#saveBtn');
  await page.waitForFunction(() => /已保存/.test(document.querySelector('#saveState')?.textContent || ''));
  await page.click('#backReadBtn');
  await page.click('#confirmBtn');
  await page.click('#confirmMenu [data-act="review"]');
  await page.waitForFunction(() => /原创度/.test(document.querySelector('#reviewFlags')?.textContent || ''), null, { timeout: 10000 });
  if (shot) await page.screenshot({ path: shot + '-copy.png' });
  return (await page.textContent('#reviewFlags .flag')).replace(/\s+/g, ' ').trim().slice(0, 80);
});
console.log(log.join('\n'));
console.log('ERRORS', errors.length ? '\n' + errors.join('\n') : 'none');
await browser.close();
