// 顶栏「素材库」：侧栏分类、新增素材整页（文本 / 保存并继续 / 图片 / 存进选题池 / 草稿）、详情加标签、筛选、批量删除、编辑
import { chromium } from 'playwright';
const B = process.argv[2];
const shot = process.argv[3];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.setDefaultTimeout(10000);
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
const log = [];
const step = async (name, fn) => {
  try { const r = await fn(); log.push(`ok   ${name}${r !== undefined ? ` → ${r}` : ''}`); }
  catch (e) { log.push(`FAIL ${name}: ${e.message.split('\n')[0]}`); }
};
const rows = () => page.$$eval('#libList [data-mat]', (els) => els.length);
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

await step('注册 → 进素材库：侧栏换成素材分类', async () => {
  await page.goto(B + '/app');
  await page.click('#authTabs [data-mode="register"]');
  await page.fill('#authForm [name=username]', 'lib' + Date.now().toString(36));
  await page.fill('#authForm [name=password]', 'secret123');
  await page.click('#authSubmit');
  await page.waitForSelector('#app:not(.hidden)');
  await page.evaluate(() => fetch('/api/personas', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '素材测试号', platform: 'xiaohongshu' }) }));
  await page.reload();
  await page.waitForSelector('#app:not(.hidden)');
  await page.click('[data-view="library"]');
  await page.waitForSelector('#libKinds [data-kind-nav="文章"]');
  if (await page.isVisible('#personaList')) throw new Error('素材库页不该显示账号设定');
  if (await page.$('#historyFilter')) throw new Error('素材库页不该显示创作记录');
  await page.click('[data-view="write"]');
  await page.waitForSelector('#historyFilter');
  await page.click('[data-view="library"]');
  await page.waitForSelector('#libKinds');
  return `${await page.$$eval('#libKinds .kind-nav', (els) => els.length)} 个分类`;
});

await step('新增素材是整页：填文本 → 保存并继续新建 → 再存一条', async () => {
  await page.click('#libNewBtn');
  await page.waitForSelector('#matForm');
  if (!await page.isVisible('#libKinds')) throw new Error('新增页侧栏仍应是素材分类');
  await page.fill('#matBody', '刚升组长那年，我把所有活都揽在自己身上，结果项目延期两周。');
  await page.fill('#matTitle', '第一次带团队踩的坑');
  await page.fill('#matTags', '经历，职场');
  await page.waitForSelector('.mat-draft:has-text("草稿已存在本机")');
  await page.click('#matSaveAgain');
  await page.waitForFunction(() => document.querySelector('#matTitle')?.value === '');
  await page.fill('#matBody', '女性用户占比约七成，一二线城市用户过半。');
  await page.click('.mat-presets .tag-chip:has-text("数据")');
  await page.click('#matSave');
  await page.waitForSelector('#libList');
  const n = await rows();
  if (n !== 2) throw new Error(`应有 2 条，实际 ${n}`);
  // 不填标题时用正文第一句
  return (await page.textContent('#libList')).includes('女性用户占比约七成') ? '标题自动取正文' : 'no auto title';
});

await step('图片素材：选图 → 列表出缩略图', async () => {
  await page.click('#libNewBtn');
  await page.click('.mat-mode[data-mode="image"]');
  await page.setInputFiles('.mat-drop input[type=file]', { name: '青海湖.png', mimeType: 'image/png', buffer: PNG });
  await page.waitForSelector('.mat-drop.has img');
  if (await page.inputValue('#matTitle') !== '青海湖') throw new Error('标题没取文件名');
  if (!await page.isVisible('[data-pick="图片"].on')) throw new Error('种类没跟着变成图片');
  await page.fill('#matBody', '环湖自驾路线');
  await page.click('#matSave');
  await page.waitForSelector('#libList .lib-thumb img');
  const ok = await page.$eval('#libList .lib-thumb img', (img) => img.complete && img.naturalWidth > 0);
  return ok ? '图片能显示' : '图片没加载出来';
});

await step('选题灵感：在新增页选「选题池」存进去', async () => {
  await page.click('#libNewBtn');
  await page.click('[data-pick="选题灵感"]');
  if (!await page.isChecked('input[name=matTarget][value=pool]')) throw new Error('目标没切到选题池');
  await page.waitForSelector('#matPersona');
  await page.fill('#matTitle', '下班后怎么学一门新技能');
  await page.click('#matSave');
  await page.waitForSelector('.lib-pool .pool-table');
  if (!await page.isVisible('[data-kind-nav="pool"].on')) throw new Error('侧栏没切到选题灵感');
  return (await page.textContent('.lib-pool')).includes('下班后怎么学一门新技能') ? '在选题池里' : 'missing';
});

await step('草稿：没存就离开，再点新建能接着写；取消会丢掉草稿', async () => {
  await page.click('[data-kind-nav=""]');
  await page.click('#libNewBtn');
  await page.fill('#matBody', '一条没写完的素材');
  await page.waitForSelector('.mat-draft:has-text("草稿已存在本机")');
  await page.click('[data-view="hot"]');
  await page.click('[data-view="library"]');
  await page.waitForSelector('#matForm');
  if (await page.inputValue('#matBody') !== '一条没写完的素材') throw new Error('草稿没接上');
  await page.click('#matCancel');
  await page.click('#libNewBtn');
  const v = await page.inputValue('#matBody');
  await page.click('#matCancel');
  if (v) throw new Error('取消后草稿还在');
  return 'ok';
});

await step('分类与筛选：侧栏点「文章」、更多筛选按标签', async () => {
  await page.waitForSelector('#libList');
  await page.click('#libKinds [data-kind-nav="文章"]');
  const a = await rows();
  await page.click('#libKinds [data-kind-nav=""]');
  await page.click('#libFilterBtn');
  await page.click('#libTagFilter .tag-chip:has-text("经历")');
  await page.click('.lib-pop-foot .btn.primary');
  const b = await rows();
  await page.click('.lib-active-tag button');
  return `文章 ${a} 条｜经历 ${b} 条｜全部 ${await rows()} 条`;
});

await step('详情：加标签、来源和正文', async () => {
  await page.click('#libList [data-mat]:has-text("第一次带团队踩的坑")');
  await page.waitForSelector('#libDetail');
  await page.click('.lib-tag-add-btn');
  await page.fill('.lib-tag-add input', '带团队');
  await page.press('.lib-tag-add input', 'Enter');
  await page.waitForSelector('#libDetail .lib-tags span:has-text("带团队")');
  if (shot) await page.screenshot({ path: shot + '.png' });
  return (await page.textContent('#libDetail .lib-tags')).replace(/\s+/g, ' ').trim();
});

await step('编辑：改标题保存', async () => {
  await page.click('#libDetail .btn.primary');
  await page.waitForSelector('#matForm h2:has-text("编辑素材")');
  await page.fill('#matTitle', '第一次带团队踩的坑（改）');
  await page.click('#matSave');
  await page.waitForSelector('#libList [data-mat]:has-text("（改）")');
});

await step('批量删除：勾两条 → 删除选中', async () => {
  const before = await rows();
  const boxes = await page.$$('#libList [data-mat] input[type=checkbox]');
  await boxes[0].check();
  await boxes[1].check();
  await page.waitForSelector('.lib-count:has-text("已选择 2 条")');
  await page.click('#libBatchDel');
  await page.click('.ask-foot [data-yes]');
  await page.waitForFunction((n) => document.querySelectorAll('#libList [data-mat]').length === n - 2, before);
  return `${before} → ${await rows()}`;
});

console.log(log.join('\n'));
console.log('ERRORS', errors.length ? '\n' + errors.join('\n') : 'none');
await browser.close();
