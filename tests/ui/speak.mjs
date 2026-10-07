// 顶栏「口播」一级页：切换视图、评测记录详情（打分 / 音视频）、去练页签
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
const menu = async (act) => { await page.click('#confirmBtn'); await page.click(`#confirmMenu [data-act="${act}"]`); };

await step('注册 → 成稿 → 口播上传', async () => {
  await page.goto(B + '/app');
  await page.click('#authTabs [data-mode="register"]');
  await page.fill('#authForm [name=username]', 'spk' + Date.now().toString(36));
  await page.fill('#authForm [name=password]', 'secret123');
  await page.click('#authSubmit');
  await page.waitForSelector('#app:not(.hidden)');
  await page.evaluate(() => fetch('/api/plan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"plan":"pro"}' }));
  if (await page.isVisible('#onboardBtn')) await page.click('#onboardBtn'); else await page.click('#newPersonaBtn');
  await page.fill('#personaForm [name=name]', '口播页测试号');
  await page.click('#personaSaveBtn');
  await page.waitForTimeout(600);
  if (await page.isVisible('#personaCloseBtn')) await page.click('#personaCloseBtn').catch(() => {});
  await page.fill('#briefForm [name=subject]', '周末备菜');
  await page.click('#topicsBtn');
  await page.waitForSelector('#topics [data-index="0"]');
  await page.click('#topics [data-index="0"]');
  await page.waitForFunction(() => document.querySelector('#content')?.textContent.length > 100 && !document.querySelector('#content .cursor'), null, { timeout: 15000 });
  await menu('cues');
  await page.waitForSelector('#speakUploadBtn:not([disabled])', { timeout: 15000 });
  await page.setInputFiles('#speakFile', { name: 'take.mp4', mimeType: 'video/mp4', buffer: Buffer.alloc(2048, 1) });
  await page.waitForSelector('[data-speak-pron]', { timeout: 15000 });
});

await step('两版口播：切到视频号口播版生成；逐段改语气和词', async () => {
  await page.waitForSelector('#cueTracks');
  await page.click('#cueTracks [data-track="shipinhao"]');
  await page.click('#cuesRunBtn');
  await page.waitForSelector('#cueList [data-cue="0"] [data-cue-edit]', { timeout: 20000 });
  await page.click('#cueList [data-cue-edit="0"]');
  const q = await page.inputValue('#cueList .cue-quote-input');
  await page.fill('#cueList .cue-quote-input', `${q}改`);
  await page.fill('#cueList .cue.editing input[placeholder^="例：带点自嘲"]', '笑着说');
  await page.click('#cueList [data-cue-save="0"]');
  await page.waitForFunction(() => /笑着说/.test(document.querySelector('#cueList [data-cue="0"]')?.textContent || ''));
  const v = await page.evaluate(async () => {
    const id = document.querySelector('.history-item.active')?.dataset.id;
    return (await (await fetch(`/api/drafts/${id}`)).json()).draft.variants.shipinhao;
  });
  if (!v.content.includes(`${q}改`)) throw new Error('改的词没进视频号版本');
  await page.click('#cueTracks [data-track="main"]');
  await page.waitForSelector('#cueList [data-cue="0"]');
  return `${v.cues.cues.length} 段`;
});

await step('抖音版本：版本栏切过去也有口播、提词器、复制口播稿', async () => {
  await page.click('#workSide [data-side="multi"]');
  await page.waitForSelector('#multiPick');
  for (const box of await page.$$('#multiPick input')) await box.setChecked(false);
  await page.check('#multiPick input[value="douyin"]');
  await page.click('#multiRunBtn');
  await page.waitForSelector('#verTabs [data-ver="douyin"]', { timeout: 20000 });
  await page.click('#verTabs [data-ver="douyin"]');
  // 口播模式下切到抖音版：口播区跟着切过去，可以直接生成
  await page.waitForSelector('#cueTracks [data-track="douyin"].on');
  await page.click('#cuesRunBtn');
  await page.waitForSelector('#cueList [data-cue="0"]', { timeout: 20000 });
  await page.waitForSelector('#prompterBtn');
  await page.waitForSelector('#copyCuesBtn');
  // 右栏口播面板也有提词器和复制口播稿
  await page.waitForSelector('#workSide [data-side="prompter"]');
  await page.waitForSelector('#workSide [data-side="copyCues"]');
  await page.click('#verTabs [data-ver=""]');
  await page.waitForSelector('#cueTracks [data-track="main"].on');
  return `抖音 ${await page.$$eval('#cueList [data-cue]', (n) => n.length)} 段`;
});

await step('顶栏切到口播页，创作区藏起来', async () => {
  await page.click('#viewNav [data-view="speak"]');
  await page.waitForSelector('#speakView:not(.hidden)');
  const writeHidden = await page.$eval('#writeView', (n) => n.classList.contains('hidden'));
  return `创作隐藏=${writeHidden}`;
});

await step('评测记录：点开详情能看打分和视频', async () => {
  await page.click('#speakTabRecords');
  await page.waitForSelector('#speakPageList [data-speak-row]');
  await page.click('#speakPageList [data-speak-row]');
  await page.waitForSelector('#speakPageDetail .speak-review');
  await page.waitForSelector('#speakPageDetail video.speak-media, #speakPageDetail video, #speakPageDetail audio');
  if (shot) await page.screenshot({ path: shot + '.png' });
  const t = (await page.textContent('#speakPageDetail')).replace(/\s+/g, ' ').trim();
  return t.slice(0, 120);
});

await step('去练页签能打开', async () => {
  await page.click('#speakTabPractice');
  await page.waitForSelector('#speakTabPractice[aria-selected="true"]');
  return /去练|待练|可再练|没有可练/.test(await page.textContent('#speakView')) ? 'ok' : 'unexpected';
});

console.log(log.join('\n'));
console.log('ERRORS', errors.length ? '\n' + errors.join('\n') : 'none');
await browser.close();
