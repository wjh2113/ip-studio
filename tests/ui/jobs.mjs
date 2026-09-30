// 长任务队列：出图、口播上传、语音/视频测评都走任务，任务中心能看到
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

await step('注册 → 升级 → 成稿', async () => {
  await page.goto(B + '/app');
  await page.click('#authTabs [data-mode="register"]');
  await page.fill('#authForm [name=username]', 'jb' + Date.now().toString(36));
  await page.fill('#authForm [name=password]', 'secret123');
  await page.click('#authSubmit');
  await page.waitForSelector('#app:not(.hidden)');
  await page.evaluate(() => fetch('/api/plan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"plan":"pro"}' }));
  if (await page.isVisible('#onboardBtn')) await page.click('#onboardBtn'); else await page.click('#newPersonaBtn');
  await page.fill('#personaForm [name=name]', '任务测试号');
  await page.click('#personaSaveBtn');
  await page.waitForTimeout(600);
  if (await page.isVisible('#personaCloseBtn')) await page.click('#personaCloseBtn').catch(() => {});
  await page.fill('#briefForm [name=subject]', '周末备菜');
  await page.click('#topicsBtn');
  await page.waitForSelector('#topics [data-index="0"]');
  await page.click('#topics [data-index="0"]');
  await page.waitForFunction(() => document.querySelector('#content')?.textContent.length > 100 && !document.querySelector('#content .cursor'), null, { timeout: 15000 });
});
await step('配图 → 出一张（走任务）', async () => {
  await menu('illus');
  await page.waitForSelector('#illusList [data-illimg="0"]');
  await page.click('#illusList [data-illimg="0"]');
  await page.waitForSelector('#illusList .illus-row img');
  return await page.textContent('#illusHint');
});
await step('口播提示 → 上传视频', async () => {
  await menu('cues');
  await page.waitForSelector('#speakUploadBtn:not([disabled])', { timeout: 15000 });
  await page.setInputFiles('#speakFile', { name: 'take.mp4', mimeType: 'video/mp4', buffer: Buffer.alloc(2048, 1) });
  await page.waitForSelector('[data-speak-pron]', { timeout: 15000 });
  return (await page.textContent('.speak-row .speak-sum')).replace(/\s+/g, ' ').trim();
});
await step('语音测评', async () => {
  await page.click('[data-speak-pron]');
  await page.waitForFunction(() => /重新语音测评/.test(document.querySelector('[data-speak-pron]')?.textContent || ''));
  return (await page.textContent('.speak-dims')).replace(/\s+/g, ' ').trim().slice(0, 80);
});
await step('视频测评', async () => {
  await page.click('[data-speak-look]');
  await page.waitForFunction(() => /重新视频测评/.test(document.querySelector('[data-speak-look]')?.textContent || ''));
  return 'ok';
});
await step('老接口不带 async 仍然同步回结果', async () => {
  const r = await page.evaluate(async () => {
    const s = (await (await fetch('/api/speaks')).json()).speaks[0];
    const res = await fetch(`/api/speaks/${s.id}/pronounce`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    const d = await res.json();
    return `${res.status} ${d.speak?.review?.checks?.voice}`;
  });
  return r;
});
await step('任务中心', async () => {
  await page.click('#jobsBtn');
  await page.waitForSelector('#jobsModal:not(.hidden) .job-row');
  if (shot) await page.screenshot({ path: shot + '-center.png' });
  return (await page.$$eval('.job-row', (rs) => rs.map((r) => r.querySelector('b').textContent.split(' · ')[0] + ':' + r.querySelector('.job-st').textContent))).join(' | ');
});
await step('去看看 → 打开口播记录', async () => {
  await page.click('.job-row [data-job-open]');
  await page.waitForSelector('#jobsModal.hidden', { state: 'attached' });
  return 'ok';
});
await step('刷新页面后任务列表还在', async () => {
  await page.reload();
  await page.waitForSelector('#app:not(.hidden)');
  await page.click('#jobsBtn');
  await page.waitForSelector('#jobsModal:not(.hidden) .job-row');
  return (await page.$$('.job-row')).length + ' 条';
});
console.log(log.join('\n'));
console.log('ERRORS', errors.length ? '\n' + errors.join('\n') : 'none');
await browser.close();
