// 快速建号：贴自我介绍 + 旧文章 → 设定表单填好 → 保存 → 语气样本批量存上
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
const post = (t) => `${t}\n` + '周末花两个小时把一周的菜备好，工作日下班十五分钟就能吃上热饭。'.repeat(4);

await step('注册 → 看到引导卡', async () => {
  await page.goto(B + '/app');
  await page.click('#authTabs [data-mode="register"]');
  await page.fill('#authForm [name=username]', 'qs' + Date.now().toString(36));
  await page.fill('#authForm [name=password]', 'secret123');
  await page.click('#authSubmit');
  await page.waitForSelector('#quickBtn', { state: 'visible' });
  return (await page.textContent('#onboardCard .onboard-acts')).replace(/\s+/g, ' ').trim();
});
await step('太短的介绍被拦下', async () => {
  await page.click('#quickBtn');
  await page.fill('#quickIntro', '我是博主');
  await page.click('#quickRun');
  await page.waitForFunction(() => document.querySelector('#quickError').textContent.length > 0);
  return await page.textContent('#quickError');
});
await step('贴介绍和两篇旧文章 → 表单填好', async () => {
  await page.fill('#quickIntro', '我今年 32 岁，做了 8 年产品经理，二胎妈妈。在小红书写职场妈妈怎么备菜、怎么安排时间，读者大多是刚回职场的女性。');
  await page.fill('#quickPosts', `${post('第一篇 周末备菜')}\n---\n${post('第二篇 十五分钟晚饭')}\n---\n太短的不要`);
  await page.click('#quickRun');
  await page.waitForSelector('#personaModal:not(.hidden)');
  await page.waitForFunction(() => /已按你的介绍填好/.test(document.querySelector('#personaSaveHint').textContent));
  if (shot) await page.screenshot({ path: shot + '-form.png' });
  const focus = await page.inputValue('#personaForm [name=content_focus]');
  return `${await page.textContent('#personaSaveHint')}｜名称 ${await page.inputValue('#personaForm [name=name]')}｜${focus.slice(0, 30)}`;
});
await step('保存 → 语气样本批量存上', async () => {
  await page.click('#personaSaveBtn');
  await page.waitForFunction(() => /语气样本/.test(document.querySelector('#personaSaveHint').textContent) && /存了/.test(document.querySelector('#personaSaveHint').textContent), null, { timeout: 15000 });
  const hint = await page.textContent('#personaSaveHint');
  const n = await page.evaluate(async () => {
    const p = (await (await fetch('/api/personas')).json()).personas[0];
    const d = await (await fetch(`/api/personas/${p.id}/samples`)).json();
    return `${d.samples.length} 篇样本，档案 ${d.digest ? '有' : '无'}`;
  });
  return `${hint}｜${n}`;
});
await step('新建账号弹窗里也有入口；取消后旧文章作废', async () => {
  await page.click('#personaCloseBtn');
  await page.click('#newPersonaBtn');
  await page.waitForSelector('#quickTip:not(.hidden)');
  await page.click('#quickLink');
  await page.waitForSelector('#quickModal:not(.hidden)');
  await page.click('#quickClose');
  await page.click('#personaCloseBtn');
  return 'ok';
});
console.log(log.join('\n'));
console.log('ERRORS', errors.length ? '\n' + errors.join('\n') : 'none');
await browser.close();
