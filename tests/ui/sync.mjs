// 顶栏「同步」：生成同步密钥（只显示一次）→ 用它调导出接口 → 作废后失效；插件文件能下载
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
let key = '';

await step('注册 → 打开「同步」', async () => {
  await page.goto(B + '/app');
  await page.click('#authTabs [data-mode="register"]');
  await page.fill('#authForm [name=username]', 'syn' + Date.now().toString(36));
  await page.fill('#authForm [name=password]', 'secret123');
  await page.click('#authSubmit');
  await page.waitForSelector('#app:not(.hidden)');
  await page.click('#syncBtn');
  await page.waitForSelector('#syncModal:not(.hidden)');
  const server = await page.textContent('#syncServer');
  if (server !== B) throw new Error(`服务器地址显示的是 ${server}`);
  return (await page.textContent('#syncKeyList')).trim();
});

await step('生成密钥：明文只显示这一次，列表里只有前缀', async () => {
  await page.fill('#syncKeyName', '家里的 Windows');
  await page.click('#syncMakeBtn');
  await page.waitForSelector('#syncNewKey .sync-key');
  key = (await page.textContent('#syncNewKey .sync-key')).trim();
  if (!/^ips_[0-9a-f]{40}$/.test(key)) throw new Error(`密钥格式不对：${key}`);
  await page.waitForSelector('#syncKeyList [data-key-id]');
  const row = await page.textContent('#syncKeyList [data-key-id]');
  if (row.includes(key)) throw new Error('列表里不该有完整密钥');
  if (shot) await page.screenshot({ path: shot + '.png' });
  // 关掉再开：明文没了
  await page.click('#syncClose');
  await page.click('#syncBtn');
  await page.waitForSelector('#syncModal:not(.hidden) #syncKeyList [data-key-id]');
  if (await page.isVisible('#syncNewKey')) throw new Error('重开后还显示明文');
  return row.replace(/\s+/g, ' ').trim();
});

await step('用密钥调导出接口；插件文件能下载', async () => {
  // 走 Playwright 的请求（不经过页面）：带的是密钥，认密钥优先于 cookie
  const res = await page.request.get(`${B}/api/export/drafts`, { headers: { Authorization: `Bearer ${key}` } });
  const plugin = await page.request.get(`${B}/api/export/plugin/manifest.json`);
  const r = { status: res.status(), body: await res.json(), plugin: (await plugin.json()).id };
  if (r.status !== 200) throw new Error(`导出 ${r.status}`);
  return `导出 ${r.body.items.length} 篇｜插件 ${r.plugin}`;
});

await step('作废：确认后列表清空，密钥立即失效', async () => {
  await page.click('#syncKeyList [data-key-id] .btn.danger');
  await page.click('.ask-foot [data-yes]');
  await page.waitForFunction(() => !document.querySelector('#syncKeyList [data-key-id]'));
  const status = (await page.request.get(`${B}/api/export/drafts`, { headers: { Authorization: `Bearer ${key}` } })).status();
  if (status !== 401) throw new Error(`作废后还是 ${status}`);
  return 'ok';
});

console.log(log.join('\n'));
console.log('ERRORS', errors.length ? '\n' + errors.join('\n') : 'none');
await browser.close();
