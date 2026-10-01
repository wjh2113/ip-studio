// 热点板块：切换视图、手动粘榜单比对、一键带回创作简报
import { chromium } from 'playwright';
const B = process.argv[2];
const shot = process.argv[3];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.setDefaultTimeout(10000);
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
// 测试环境连不上外网，抓全网榜单的接口会回 502：这条是预期的，不算页面错误
page.on('console', (m) => { if (m.type() === 'error' && !/status of 502/.test(m.text())) errors.push(`console: ${m.text()}`); });
const log = [];
const step = async (name, fn) => {
  try { const r = await fn(); log.push(`ok   ${name}${r !== undefined ? ` → ${r}` : ''}`); }
  catch (e) { log.push(`FAIL ${name}: ${e.message.split('\n')[0]}`); }
};

await step('注册 → 建号', async () => {
  await page.goto(B + '/app');
  await page.click('#authTabs [data-mode="register"]');
  await page.fill('#authForm [name=username]', 'ht' + Date.now().toString(36));
  await page.fill('#authForm [name=password]', 'secret123');
  await page.click('#authSubmit');
  await page.waitForSelector('#app:not(.hidden)');
  if (await page.isVisible('#onboardBtn')) await page.click('#onboardBtn'); else await page.click('#newPersonaBtn');
  await page.fill('#personaForm [name=name]', '热点测试号');
  await page.fill('#personaForm [name=content_focus]', '上班族的省时做饭');
  await page.click('#personaSaveBtn');
  await page.waitForTimeout(600);
  if (await page.isVisible('#personaCloseBtn')) await page.click('#personaCloseBtn').catch(() => {});
});
await step('切到热点：创作区藏起来', async () => {
  await page.click('#viewNav [data-view="hot"]');
  await page.waitForSelector('#hotView:not(.hidden)');
  const write = await page.$eval('#writeView', (n) => n.classList.contains('hidden'));
  return `${(await page.textContent('#hotIntro')).trim().slice(0, 30)}…｜创作区隐藏=${write}`;
});
await step('手动粘一份榜单比对', async () => {
  await page.fill('#manualInput', ['打工人带饭成新潮流', '某地暴雨致多人伤亡', '周末备菜教程走红', '空气炸锅十分钟晚饭', '年轻人开始自己做早餐', '外卖涨价引热议']
    .map((t, i) => `${i + 1}. ${t}`).join('\n'));
  await page.click('#manualRun');
  await page.waitForFunction(() => {
    const t = document.querySelector('#hotMatches')?.textContent || '';
    return /比对了/.test(t) || /hot-note/.test(document.querySelector('#hotMatches')?.innerHTML || '');
  }, null, { timeout: 15000 });
  if (shot) await page.screenshot({ path: shot + '.png' });
  return (await page.textContent('#hotMatches')).replace(/\s+/g, ' ').trim().slice(0, 90);
});
await step('用这个题材去创作 → 回到简报，带上热点', async () => {
  const btn = await page.$('#hotMatches [data-match]');
  if (!btn) return '这一轮没有匹配，跳过';
  await btn.click();
  await page.waitForSelector('#writeView:not(.hidden)');
  await page.waitForSelector('#hotRef:not(.hidden)');
  return `${await page.inputValue('#briefForm [name=subject]')}｜${(await page.textContent('#hotRef')).replace(/\s+/g, ' ').trim().slice(0, 40)}`;
});
console.log(log.join('\n'));
console.log('ERRORS', errors.length ? '\n' + errors.join('\n') : 'none');
await browser.close();
