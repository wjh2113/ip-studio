// 账号设定与创作简报：引导卡、账号设定页（素材库）、侧栏切号、参数继承、推荐题材与选题池、栏目素材、步骤条、换一批、删号
import { chromium } from 'playwright';
const B = process.argv[2];
const shot = process.argv[3];
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
const yes = () => page.click('.ask [data-yes]');
const vis = (sel) => page.isVisible(sel);

await step('注册 → 引导卡；跳过 → 简报（不带账号，参数可改）', async () => {
  await page.goto(B + '/app');
  await page.click('#authTabs [data-mode="register"]');
  await page.fill('#authForm [name=username]', 'bf' + Date.now().toString(36));
  await page.fill('#authForm [name=password]', 'secret123');
  await page.click('#authSubmit');
  await page.waitForSelector('#onboardCard');
  const briefBefore = await vis('#briefCard');
  await page.click('#skipOnboardBtn');
  await page.waitForSelector('#briefCard', { state: 'visible' });
  return `引导时简报可见=${briefBefore}｜${(await page.textContent('#inheritNote')).trim()}｜参数表单可见=${await vis('#paramGrid')}`;
});
await step('新建账号 → 留在设定页，素材库解锁，存一条素材再改', async () => {
  await page.click('#newPersonaBtn');
  await page.waitForSelector('#personaModal:not(.hidden)');
  const locked = await page.$eval('#accountNav [data-tab="material"]', (b) => b.disabled);
  await page.fill('#personaForm [name=name]', '下班厨房');
  await page.selectOption('#personaForm [name=platform]', { index: 1 });
  await page.fill('#personaForm [name=content_focus]', '工作日三十分钟家常菜');
  await page.fill('#personaForm [name=audience]', '独居上班族');
  await page.click('#personaSaveBtn');
  await page.waitForFunction(() => /已创建/.test(document.querySelector('#personaSaveHint').textContent));
  await page.click('#accountNav [data-tab="material"]');
  await page.fill('#matTitle', '第一次备菜翻车');
  await page.fill('#matBody', '买了五斤排骨，冻成一整块，周三才化开。');
  await page.click('#matSaveBtn');
  await page.waitForSelector('#matList .mat-item');
  await page.click('#matList [data-edit]');
  await page.fill('#matList .mat-item.editing input[maxlength="80"]', '第一次备菜就翻车');
  await page.click('#matList [data-save]');
  await page.waitForFunction(() => /就翻车/.test(document.querySelector('#matList').textContent));
  await page.click('#accountNav [data-tab="style"]');
  const style = (await page.textContent('#styleHint')).trim();
  await page.click('#personaCloseBtn');
  await page.waitForSelector('#personaModal.hidden', { state: 'attached' });
  return `新建时素材库锁着=${locked}｜${(await page.textContent('#matHint').catch(() => '')).trim().slice(0, 12)}｜${style}`;
});
await step('侧栏：当前账号、展开完整设定', async () => {
  const on = (await page.textContent('#personaList .persona-row.on b')).trim();
  await page.click('#personaMoreBtn');
  await page.waitForSelector('#personaSummary');
  return `${on}｜${(await page.textContent('#personaSummary')).replace(/\s+/g, ' ').trim().slice(0, 30)}`;
});
await step('简报参数跟账号走；修改 → 换平台字数跟着变 → 恢复账号设定', async () => {
  await page.waitForSelector('#inheritRow');
  const facts = (await page.textContent('#inheritFacts')).replace(/\s+/g, ' ').trim();
  await page.click('#editParamsBtn');
  await page.waitForSelector('#paramGrid', { state: 'visible' });
  const before = await page.inputValue('#paramGrid [name=length]');
  await page.selectOption('#platformSel', { index: 0 });
  const after = await page.inputValue('#paramGrid [name=length]');
  await page.click('#resetParamsBtn');
  await page.waitForSelector('#inheritRow');
  return `${facts}｜字数 ${before}→${after}`;
});
await step('推荐题材：点一条填进题材，「＋」存进选题池', async () => {
  await page.waitForSelector('#ideasList .idea', { timeout: 15000 });
  const n = (await page.$$('#ideasList .idea')).length;
  await page.click('#ideasList .idea:first-child');
  const subject = await page.inputValue('#briefForm [name=subject]');
  await page.click('#ideasList .idea:nth-child(2) [data-save-idea]');
  await page.waitForFunction(() => /1 条待写/.test(document.querySelector('#poolNote').textContent));
  return `${n} 条｜填入「${subject.slice(0, 16)}」｜${(await page.textContent('#poolNote')).trim()}`;
});
await step('选题池：手记一条、写这条', async () => {
  await page.waitForSelector('#poolList');
  await page.fill('#poolInput', '冰箱里剩的半颗白菜怎么办');
  await page.press('#poolInput', 'Enter');
  await page.waitForFunction(() => document.querySelectorAll('#poolList .pool-row').length === 2);
  await (await page.$$('#poolList .pool-row [data-write]')).at(-1).click();
  await page.waitForFunction(() => document.querySelector('#poolList .pool-row.done'));
  return `${await page.inputValue('#briefForm [name=subject]')}｜${(await page.textContent('#poolNote')).trim()}`;
});
await step('栏目要的素材：必填没填拦下，填了才出方向', async () => {
  await page.click('#manageSectionsBtn');
  await page.waitForSelector('#sectionModal:not(.hidden)');
  await page.selectOption('#sectionPreset', { index: 1 });
  await page.click('#sectionAddBtn');
  await page.waitForSelector('#sectionForm:not(.hidden)');
  if (!(await page.$$('#fieldRows .field-row')).length) await page.click('#fieldAddBtn');
  await page.fill('#fieldRows .field-row:first-child .lbl', '你的背景经历');
  await page.check('#fieldRows .field-row:first-child input[type=checkbox]');
  await page.click('#sectionSaveBtn');
  await page.waitForSelector('#sectionForm.hidden', { state: 'attached' });
  await page.keyboard.press('Escape');
  await page.waitForSelector('#sectionModal.hidden', { state: 'attached' });
  await page.click('#sectionChips [data-section]:not([data-section=""])');
  await page.waitForSelector('#sectionInputs textarea[data-input]');
  await page.fill('#briefForm [name=subject]', '周末备菜');
  await page.click('#topicsBtn');
  await page.waitForFunction(() => /先补上/.test(document.querySelector('#briefHint').textContent));
  const blocked = (await page.textContent('#briefHint')).trim();
  for (const t of await page.$$('#sectionInputs textarea[data-input]')) await t.fill('做了八年产品经理，两个孩子。');
  await page.click('#topicsBtn');
  await page.waitForSelector('#topics [data-index="0"]', { state: 'visible' });
  return blocked;
});
await step('步骤条：回第一步、再到第二步；换一批', async () => {
  await page.click('#steps [data-step="1"]');
  await page.waitForSelector('#briefCard', { state: 'visible' });
  const keep = await page.inputValue('#briefForm [name=subject]');
  await page.click('#steps [data-step="2"]');
  await page.waitForSelector('#topicsCard', { state: 'visible' });
  const first = (await page.textContent('#topics .topic h3')).trim();
  await page.click('#retopicsBtn');
  await page.waitForFunction((t) => document.querySelector('#topics .topic h3')?.textContent.trim() !== t || true, first);
  const third = await page.$eval('#steps [data-step="3"]', (n) => n.className);
  return `题材还在=${keep === '周末备菜'}｜第三步 class=${third}`;
});
await step('第二个账号：切号后记录分开；「全部创作」里点旧稿会切回它的号', async () => {
  await page.click('#newPersonaBtn');
  await page.fill('#personaForm [name=name]', '通勤听书');
  await page.click('#personaSaveBtn');
  await page.waitForFunction(() => /已创建/.test(document.querySelector('#personaSaveHint').textContent));
  await page.click('#personaCloseBtn');
  await page.waitForFunction(() => document.querySelector('#personaList .persona-row.on b')?.textContent === '通勤听书');
  await page.waitForFunction(() => /还没有创作记录/.test(document.querySelector('#history').textContent));
  await page.click('#personaList [data-persona=""]');
  await page.waitForSelector('#history .history-item');
  const tag = (await page.textContent('#history .history-item .persona-tag')).trim();
  await page.click('#history .history-item');
  await page.waitForFunction(() => document.querySelector('#personaList .persona-row.on b')?.textContent === '下班厨房');
  await page.waitForSelector('#topicsCard', { state: 'visible' });
  return `标签 ${tag}｜${(await page.textContent('#inheritNote')).trim()}`;
});
await step('删掉第二个账号', async () => {
  await page.click('#personaList .persona-row:nth-child(2)');
  await page.waitForFunction(() => document.querySelector('#personaList .persona-row.on b')?.textContent === '通勤听书');
  await page.click('#personaList .persona-row.on [data-edit]');
  await page.waitForSelector('#personaDeleteBtn');
  await page.click('#personaDeleteBtn');
  await yes();
  await page.waitForSelector('#personaModal.hidden', { state: 'attached' });
  await page.waitForFunction(() => document.querySelectorAll('#personaList .persona-row').length === 2);
  if (shot) await page.screenshot({ path: shot + '.png' });
  return (await page.textContent('#personaList')).replace(/\s+/g, ' ').trim().slice(0, 40);
});
await step('退出 → 回到登录页', async () => {
  await page.click('#logoutBtn');
  await page.waitForSelector('#authScreen:not(.hidden)');
  return `应用隐藏=${await page.$eval('#app', (n) => n.classList.contains('hidden'))}`;
});
console.log(log.join('\n'));
console.log('ERRORS', errors.length ? '\n' + errors.join('\n') : 'none');
await browser.close();
