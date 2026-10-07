// 越写越懂：账号设定里的「个人档案」（贴简历拆解、勾选存、手动加）、「语气样本」导入文章、
// 「AI 眼中的我」（档案、文章里找到的经历确认、改稿习惯增删开关、学习记录），成稿页显示这篇参考了什么
import { chromium } from 'playwright';
const B = process.argv[2];
const shot = process.argv[3];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.setDefaultTimeout(15000);
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
const log = [];
const step = async (name, fn) => {
  try { const r = await fn(); log.push(`ok   ${name}${r !== undefined ? ` → ${r}` : ''}`); }
  catch (e) { log.push(`FAIL ${name}: ${e.message.split('\n')[0]}`); }
};
const ARTICLE = '我在一家电商公司做了三年运营主管，带过一个 5 个人的小组。那年双十一我们把转化率从 2% 拉到了 3.5%。\n后来我发现，带团队最难的不是定目标，而是让每个人知道自己为什么做这件事。我认为管理就是翻译。\n这篇想把这几年踩过的坑都写下来，给刚开始带人的朋友一点参考。';
let pid;

await step('注册、建号、打开账号设定', async () => {
  await page.goto(B + '/app');
  await page.click('#authTabs [data-mode="register"]');
  await page.fill('#authForm [name=username]', 'lrn' + Date.now().toString(36));
  await page.fill('#authForm [name=password]', 'secret123');
  await page.click('#authSubmit');
  await page.waitForSelector('#app:not(.hidden)');
  pid = await page.evaluate(async () => (await (await fetch('/api/personas', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '带团队的那些事', platform: 'gongzhonghao' }) })).json()).persona.id);
  await page.reload();
  await page.waitForSelector(`[data-persona="${pid}"]`);
  await page.click(`[data-persona="${pid}"]`);
  await page.click(`[data-persona="${pid}"] [data-edit]`);
  await page.waitForSelector('#personaModal:not(.hidden)');
  return (await page.$$eval('#accountNav [data-tab]', (els) => els.map((e) => e.dataset.tab))).join(',');
});

await step('个人档案：贴简历 → 拆成条目 → 勾掉一条 → 存进去', async () => {
  await page.click('#accountNav [data-tab="profile"]');
  await page.fill('#profileParseText', '2019 年入职某某电商公司，担任运营主管，负责 5 个人的小组\n那年双十一把转化率从 2% 拉到 3.5%\n我认为管理就是翻译');
  await page.click('#profileParseBtn');
  await page.waitForSelector('#profileCandidates .pf-cand');
  const n = (await page.$$('#profileCandidates .pf-cand')).length;
  await page.uncheck('#profileCandidates .pf-cand:nth-child(3) input[type=checkbox]');
  await page.click('#profileSaveParsed');
  await page.waitForFunction(() => document.querySelectorAll('#profileList [data-profile]').length === 2);
  return `拆出 ${n} 条，存了 2 条`;
});

await step('个人档案：手动加一条项目经历（回车不提交账号表单）', async () => {
  await page.click('[data-new-kind="project"]');
  await page.fill('#profileTitle', '双十一大促复盘');
  await page.press('#profileTitle', 'Enter');
  if (!await page.isVisible('#profileForm')) throw new Error('回车把表单提交了');
  await page.click('#profileSaveBtn');
  await page.waitForFunction(() => document.querySelectorAll('#profileList [data-profile]').length === 3);
  if (shot) await page.screenshot({ path: `${shot}-profile.png` });
});

const FIX = new URL('../fixtures/files/', import.meta.url).pathname;
await step('个人档案：选 Word 简历 → 文字读进拆解框', async () => {
  await page.setInputFiles('#profileResumeFile', FIX + 'article.docx');
  await page.waitForFunction(() => document.querySelector('#profileParseText').value.includes('第一年当组长'));
  await page.fill('#profileParseText', '');
  return 'ok';
});

await step('语气样本：选 Word + 扫描件 PDF → 一篇读出来，一篇说明读不了', async () => {
  await page.click('#accountNav [data-tab="style"]');
  await page.setInputFiles('#importFiles', [FIX + 'article.docx', FIX + 'image-only.pdf']);
  await page.waitForSelector('#importPicked');
  await page.waitForSelector('#importIssues');
  const picked = await page.textContent('#importPicked');
  if (!/已选 1 篇：我做产品经理的第五年/.test(picked)) throw new Error(picked);
  const issues = await page.textContent('#importIssues');
  if (!/image-only\.pdf：.*扫描件/.test(issues)) throw new Error(issues);
  return issues.trim().slice(0, 40);
});

await step('语气样本：粘贴一篇导入 → 后台学完显示「已学」', async () => {
  await page.click('#importClear');          // 上一步选的文件不导入：只测粘贴这一篇
  await page.click('#accountNav [data-tab="style"]');
  await page.fill('#importPasteTitle', '带团队第一年');
  await page.fill('#importPaste', ARTICLE);
  await page.click('#importBtn');
  await page.waitForSelector('#sampleList [data-sample-row]');
  // 后台任务学完后重新进这一栏能看到已学
  for (let i = 0; i < 40; i += 1) {
    const active = await page.evaluate(async () => (await (await fetch('/api/jobs')).json()).active);
    if (!active) break;
    await page.waitForTimeout(250);
  }
  await page.waitForFunction(() => /已学/.test(document.querySelector('#sampleList').textContent));
  return (await page.textContent('#sampleList')).replace(/\s+/g, ' ').trim();
});

await step('AI 眼中的我：语气档案、文章里找到的经历 → 存进档案', async () => {
  await page.click('#accountNav [data-tab="me"]');
  await page.waitForSelector('#meDigest');
  await page.waitForSelector('#meCandidates [data-accept]');
  await page.click('#meCandidates [data-accept]');
  await page.waitForFunction(() => !document.querySelector('#meCandidates'));
  const n = await page.evaluate(async () => (await (await fetch('/api/profile')).json()).entries.length);
  if (n !== 4) throw new Error(`个人档案应有 4 条，实际 ${n}`);
  return (await page.textContent('#meDigest')).slice(0, 30);
});

await step('改稿习惯：手动加一条（回车）→ 关掉 → 删掉', async () => {
  await page.fill('#meNewRule', '不用「赋能」「抓手」这类词');
  await page.press('#meNewRule', 'Enter');
  await page.waitForSelector('#mePrefs [data-pref]');
  await page.uncheck('#mePrefs [data-pref] .me-pref-on input');
  await page.waitForSelector('#mePrefs [data-pref].off');
  const st = await page.evaluate(async (p) => (await (await fetch(`/api/personas/${p}/learning`)).json()).prefs[0].status, pid);
  if (st !== 'off') throw new Error('没关掉');
  await page.check('#mePrefs [data-pref] .me-pref-on input');
  if (shot) await page.screenshot({ path: `${shot}-me.png`, fullPage: true });
  return st;
});

await step('自动学习开关', async () => {
  await page.uncheck('#autoLearnToggle');
  await page.waitForFunction(async (p) => !(await (await fetch(`/api/personas/${p}/learning`)).json()).autoLearn, pid);
  await page.check('#autoLearnToggle');
  return 'ok';
});

await step('成稿页：显示这篇参考了几条经历、几篇范文、几条改稿习惯', async () => {
  await page.click('#personaCloseBtn');
  const id = await page.evaluate(async (p) => {
    const j = (u, b) => fetch(`/api${u}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
    const { draft } = await (await j('/drafts/topics', { subject: '运营主管带团队做双十一复盘', platform: 'gongzhonghao', tone: '实用干货', length: 1000, persona_id: p })).json();
    await (await j(`/drafts/${draft.id}/content`, { index: 0 })).text();
    return draft.id;
  }, pid);
  await page.reload();
  await page.waitForSelector(`.history-item[data-id="${id}"]`);
  await page.click(`.history-item[data-id="${id}"]`);
  await page.waitForSelector('#usedLine');
  await page.click('#usedLine .link-btn');
  if (shot) await page.screenshot({ path: `${shot}-used.png` });
  return (await page.textContent('#usedLine')).replace(/\s+/g, ' ').trim().slice(0, 80);
});

console.log(log.join('\n'));
console.log('ERRORS', errors.length ? '\n' + errors.join('\n') : 'none');
await browser.close();
