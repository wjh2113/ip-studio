// 右栏 AI 对话：页签切换、问（不改正文）、局部改（列出改动 → 应用 → 撤销）、整篇改（先问再动手）、划词「问 AI」带引用、
// 检查结果「交给 AI 改」、话筒在、刷新后记录还在（应用状态也在）、保存天数、全屏可用、清空
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
const body = () => page.textContent('#content');
const lastReply = '#chatLog .chat-msg.assistant:last-child';
const waitReply = () => page.waitForFunction((sel) => {
  const el = document.querySelector(sel);
  return el && !el.querySelector('.chat-thinking');
}, lastReply);

await step('注册 → 成稿', async () => {
  await page.goto(B + '/app');
  await page.click('#authTabs [data-mode="register"]');
  await page.fill('#authForm [name=username]', 'ch' + Date.now().toString(36));
  await page.fill('#authForm [name=password]', 'secret123');
  await page.click('#authSubmit');
  await page.click('#skipOnboardBtn');
  await page.fill('#briefForm [name=subject]', '周末备菜');
  await page.click('#topicsBtn');
  await page.click('#topics [data-index="0"]');
  await page.waitForFunction(() => document.querySelector('#content')?.textContent.length > 100 && !document.querySelector('#content .cursor'), null, { timeout: 15000 });
  return (await page.textContent('#counter')).trim();
});
await step('工具条「问 AI」→ 右栏切到对话，输入框拿到焦点；切回「工具」', async () => {
  await page.click('#chatBtn');
  await page.waitForSelector('#chatPane', { state: 'visible' });
  const focused = await page.evaluate(() => document.activeElement?.id);
  const wide = await page.$eval('#workSide', (el) => el.getBoundingClientRect().width);
  await page.click('#sideTabTools');
  await page.waitForSelector('#sideTools', { state: 'visible' });
  if (await page.isVisible('#chatPane')) throw new Error('切回工具后对话还在');
  await page.click('#sideTabChat');
  await page.waitForSelector('#chatPane', { state: 'visible' });
  return `焦点=${focused}｜右栏宽 ${Math.round(wide)}`;
});
await step('问一句：只回话，正文不动', async () => {
  const before = await body();
  await page.fill('#chatInput', '这篇主线清楚吗？');
  await page.press('#chatInput', 'Enter');
  await waitReply();
  const reply = (await page.textContent(`${lastReply} .chat-reply`)).trim();
  if (await page.$(`${lastReply} .chat-changes`)) throw new Error('问问题不该给改动');
  if ((await body()) !== before) throw new Error('正文被改了');
  return reply.slice(0, 24);
});
await step('要改：列出改动 → 应用写进正文 → 撤销恢复', async () => {
  const before = await body();
  await page.fill('#chatInput', '第一段改得更抓人一点');
  await page.click('#chatSendBtn');
  await waitReply();
  await page.waitForSelector(`${lastReply} .chat-edit ins`);
  if ((await body()) !== before) throw new Error('没点应用就改了正文');
  await page.click(`${lastReply} [data-act="apply"]`);
  await page.waitForFunction((b) => document.querySelector('#content').textContent !== b, before);
  if (!/演示：按你的意思改过/.test(await body())) throw new Error('改动没写进正文');
  await page.waitForSelector(`${lastReply} .chat-done`);
  await page.click(`${lastReply} [data-act="undo"]`);
  await page.waitForFunction((b) => document.querySelector('#content').textContent === b, before);
  return '应用、撤销都对';
});
await step('整篇改：先问「开始吗」，不点不动；点「开始重写」后整篇流式重写', async () => {
  const before = await body();
  await page.fill('#chatInput', '整篇换成讲故事的写法');
  await page.press('#chatInput', 'Enter');
  await waitReply();
  await page.waitForSelector(`${lastReply} [data-act="rewrite"]`);
  const notes = (await page.textContent(`${lastReply} .chat-notes`)).trim();
  if ((await body()) !== before) throw new Error('没点就改了');
  await page.click(`${lastReply} [data-act="rewrite"]`);
  await page.waitForFunction(() => /已按意见重写/.test(document.querySelector('#toast')?.textContent || ''), null, { timeout: 15000 });
  await page.waitForSelector(`${lastReply} .chat-done`);
  const diff = await page.isVisible('#reviseDiff, .revise-diff');
  await page.keyboard.press('Control+z');
  await page.waitForFunction((b) => document.querySelector('#content').textContent === b, before);
  return `意见：${notes.slice(0, 16)}｜逐段对照=${diff}`;
});
await step('左下角选模型（像 Notion）：按钮弹出菜单，自动在最上面，按厂商分组，测试版有标签，不可用的灰掉；键盘可选；指定后回话标出模型；设置页同步', async () => {
  await page.waitForSelector('#chatModelBtn');
  if ((await page.textContent('#chatModelBtn')).trim() !== '自动') throw new Error('默认应显示「自动」');
  await page.click('#chatModelBtn');
  await page.waitForSelector('#chatModelMenu [data-model="demo-quality"]');
  const first = await page.$eval('#chatModelMenu .mpick-opt', (el) => el.dataset.model);
  if (first !== '') throw new Error('第一项应是自动');
  const checked = await page.$eval('#chatModelMenu [data-model=""]', (el) => el.getAttribute('aria-selected'));
  const groups = await page.$$eval('#chatModelMenu .mpick-group h4', (els) => els.map((e) => e.textContent.trim()));
  const tag = await page.isVisible('#chatModelMenu [data-model="demo-preview"] .mpick-tag');
  const off = await page.$eval('#chatModelMenu [data-model="demo-down"]', (el) => el.disabled);
  if (checked !== 'true' || !tag || !off) throw new Error(`勾选=${checked} 测试版标签=${tag} 不可用灰=${off}`);
  if (shot) await page.screenshot({ path: `${shot}/chat-model-menu.png` });
  // Esc 关；键盘 ↓ 打开、↓ 移到第一个模型、回车选中
  await page.keyboard.press('Escape');
  await page.waitForSelector('#chatModelMenu', { state: 'detached' });
  await page.focus('#chatModelBtn');
  await page.keyboard.press('ArrowDown');
  await page.waitForSelector('#chatModelMenu');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => /AI 对话改用：演示 · 高质量/.test(document.querySelector('#toast')?.textContent || ''));
  const label = (await page.textContent('#chatModelBtn')).trim();
  await page.fill('#chatInput', '这篇适合什么人看？');
  await page.press('#chatInput', 'Enter');
  await waitReply();
  const by = (await page.textContent(`${lastReply} .chat-by`)).trim();
  if (by !== '演示 · 高质量') throw new Error(`回话没标模型：${by}`);
  await page.click('#chatKeepLink');
  await page.waitForSelector('#settingsPage:not(.hidden)');
  await page.waitForFunction(() => document.querySelector('#settingsModelSel')?.value === 'demo-quality');
  await page.click('#settingsCloseBtn');
  await page.waitForSelector('#settingsPage.hidden', { state: 'attached' });
  // 点外面关；再选回自动
  await page.click('#chatModelBtn');
  await page.waitForSelector('#chatModelMenu');
  await page.mouse.click(10, 10);
  await page.waitForSelector('#chatModelMenu', { state: 'detached' });
  await page.click('#chatModelBtn');
  await page.click('#chatModelMenu [data-model=""]');
  await page.waitForFunction(() => /改回自动/.test(document.querySelector('#toast')?.textContent || ''));
  return `分组：${groups.join('、')}｜按钮：${label}｜回话标：${by}`;
});
await step('换个改法：按同样的要求再出一版；整段改动能「插在原文后面」', async () => {
  await page.fill('#chatInput', '第一段改得更抓人一点');
  await page.press('#chatInput', 'Enter');
  await waitReply();
  const n = await page.$$eval('#chatLog .chat-msg', (els) => els.length);
  await page.click(`${lastReply} [data-act="redo"]`);
  await page.waitForFunction((k) => document.querySelectorAll('#chatLog .chat-msg').length === k + 2, n);
  await waitReply();
  const said = (await page.textContent('#chatLog .chat-msg.user:nth-last-child(2) .chat-bubble')).trim();
  if (!/换个改法/.test(said)) throw new Error(`发出去的不是换个改法：${said}`);
  const before = await body();
  const ins = await page.$(`${lastReply} [data-act="insert"]`);
  if (!ins) return `${said.slice(0, 12)}｜这处不是整段，没有「插在原文后面」`;
  await ins.click();
  await page.waitForFunction(() => /已插在原文后面/.test(document.querySelector('#toast')?.textContent || ''));
  const after = await body();
  if (after.length <= before.length) throw new Error('插入后正文没变长');
  await page.click(`${lastReply} [data-act="undo"]`);
  await page.waitForFunction((b) => document.querySelector('#content').textContent === b, before);
  return `${said.slice(0, 12)}｜插在原文后面、撤销都行`;
});
await step('技能菜单（Notion 样式）：标题行有技能库和新建、搜索框；新建打开整页 → 从模板开始、加标签和范文 → 建好', async () => {
  await page.click('#chatSkillBtn');
  await page.waitForSelector('#chatSkillMenu #chatSkillSearch');
  const focused = await page.evaluate(() => document.activeElement?.id);
  for (const id of ['#chatSkillLib', '#chatSkillAdd', '#chatSkillNew']) if (!(await page.$(id))) throw new Error(`菜单缺 ${id}`);
  await page.fill('#chatSkillSearch', '小红书口吻');
  await page.waitForFunction(() => /新建技能「小红书口吻」/.test(document.querySelector('#chatSkillNew')?.textContent || ''));
  await page.press('#chatSkillSearch', 'Enter');               // 没有匹配：回车 = 用这个名字新建
  await page.waitForSelector('#skillPage:not(.hidden)');
  const name = await page.inputValue('#skillName');
  await page.click('#skillTemplates [data-tpl="platform"]');
  await page.fill('#skillTagInput', '常用');
  await page.press('#skillTagInput', 'Enter');
  await page.click('#skillRefText');
  await page.fill('.ask [data-k="title"]', '上周那篇');
  await page.fill('.ask [data-k="text"]', '姐妹们！今天分享一个周末备菜的小办法……');
  await page.click('.ask [data-yes]');
  await page.waitForSelector('#skillPage .skill-refs .skill-chip');
  if (shot) await page.screenshot({ path: `${shot}/skill-page.png` });
  await page.click('#skillSaveBtn');
  await page.waitForFunction(() => /已建好技能「小红书口吻」/.test(document.querySelector('#toast')?.textContent || ''));
  const tags = await page.$$eval('#skillPage .skill-tags .skill-chip', (els) => els.map((e) => e.textContent.trim()));
  await page.click('#skillBackBtn');
  await page.waitForSelector('#skillPage.hidden', { state: 'attached' });
  return `搜索框拿到焦点=${focused === 'chatSkillSearch'}｜名字=${name}｜标签：${tags.join('、')}`;
});
await step('用技能：对话里搜到点一下就发（记录里标出技能）；划词菜单里对选中那段用（结果在改写浮层）；没保存就离开会提醒', async () => {
  await page.click('#chatSkillBtn');
  await page.fill('#chatSkillSearch', '小红');
  await page.waitForSelector('#chatSkillMenu [data-skill] .mpick-opt');
  await page.press('#chatSkillSearch', 'Enter');               // 有匹配：回车 = 用第一个
  await waitReply();
  const tag = (await page.textContent('#chatLog .chat-msg.user:nth-last-child(2) .chat-skill-tag')).trim();
  // 划词
  await page.evaluate(() => {
    const p = [...document.querySelectorAll('#content p')].find((x) => x.textContent.trim().length > 12);
    const r = document.createRange();
    r.setStart(p.firstChild, 0);
    r.setEnd(p.firstChild, Math.min(10, p.firstChild.textContent.length));
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
  });
  await page.click('#rewriteBtn');
  await page.waitForSelector('#selMenu:not(.hidden) #selSkills [data-skill]');
  for (const k of ['summarize', 'translate']) if (!(await page.$(`#selMenu [data-action="${k}"]`))) throw new Error(`划词菜单缺 ${k}`);
  await page.click('#selSkills [data-skill]');
  await page.waitForSelector('#assistPop:not(.hidden) #assistReplace:not([disabled])', { timeout: 15000 });
  const title = (await page.textContent('#assistTitle')).trim();
  await page.click('#assistRetry');                             // 重来一次也带着技能
  await page.waitForSelector('#assistPop:not(.hidden) #assistReplace:not([disabled])', { timeout: 15000 });
  await page.click('#assistClose');
  // 编辑技能：改了不保存就返回 → 提醒
  await page.click('#chatSkillBtn');
  await page.hover('#chatSkillMenu [data-skill]');
  await page.click('#chatSkillMenu [data-skill] [data-act="edit"]');
  await page.waitForSelector('#skillPage:not(.hidden)');
  await page.waitForFunction(() => document.querySelector('#skillBody')?.value.length > 10);
  await page.fill('#skillDesc', '改了一下');
  await page.click('#skillBackBtn');
  await page.waitForSelector('.ask [data-yes]');
  await page.click('.ask [data-yes]');
  await page.waitForSelector('#skillPage.hidden', { state: 'attached' });
  return `对话标签：${tag}｜划词浮层：${title}｜未保存提醒 ok`;
});
await step('技能库：从菜单进；搜索、按标签筛；复制、删除；对话里说过的话能存成技能', async () => {
  await page.click('#chatSkillBtn');
  await page.click('#chatSkillLib');
  await page.waitForSelector('#skillLib:not(.hidden) #skillGrid [data-skill]');
  await page.click('#skillGrid [data-skill] [data-act="copy"]');
  await page.waitForFunction(() => document.querySelectorAll('#skillGrid [data-skill]').length === 2);
  await page.click('#skillLib [data-tag="常用"]');
  const byTag = await page.$$eval('#skillGrid [data-skill]', (els) => els.length);
  await page.fill('#skillLibSearch', '副本');
  await page.waitForFunction(() => document.querySelectorAll('#skillGrid [data-skill]').length === 1);
  if (shot) await page.screenshot({ path: `${shot}/skill-lib.png` });
  await page.click('#skillGrid [data-skill] [data-act="del"]');
  await page.click('.ask [data-yes]');
  await page.fill('#skillLibSearch', '');
  await page.waitForFunction(() => document.querySelectorAll('#skillGrid [data-skill]').length === 1);
  await page.click('#skillLibBack');
  await page.waitForSelector('#skillLib.hidden', { state: 'attached' });
  // 存成技能：打开整页，正文预填成那句话
  const msg = '#chatLog .chat-msg.user:not(:has(.chat-skill-tag))';
  await page.hover(msg);
  await page.click(`${msg} [data-act="save-skill"]`);
  await page.waitForSelector('#skillPage:not(.hidden)');
  const pre = await page.inputValue('#skillBody');
  await page.fill('#skillName', '同款再来');
  await page.click('#skillSaveBtn');
  await page.waitForFunction(() => /已建好技能「同款再来」/.test(document.querySelector('#toast')?.textContent || ''));
  await page.click('#skillBackBtn');
  await page.waitForSelector('#skillPage.hidden', { state: 'attached' });
  return `按标签「常用」${byTag} 个｜存成技能预填：${pre.slice(0, 12)}`;
});
await step('划词 →「改写」→「问 AI」：带着这段做引用', async () => {
  await page.evaluate(() => {
    const p = [...document.querySelectorAll('#content p')].find((x) => x.textContent.trim().length > 12);
    const r = document.createRange();
    r.setStart(p.firstChild, 0);
    r.setEnd(p.firstChild, Math.min(10, p.firstChild.textContent.length));
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
  });
  await page.click('#rewriteBtn');
  await page.waitForSelector('#selMenu:not(.hidden)');
  await page.click('#selAskBtn');
  await page.waitForSelector('#chatQuote');
  const q = (await page.textContent('#chatQuote')).trim();
  await page.fill('#chatInput', '这段压短一点');
  await page.press('#chatInput', 'Enter');
  await waitReply();
  if (await page.isVisible('#chatQuote')) throw new Error('发完引用还挂着');
  const quoted = await page.isVisible('#chatLog .chat-quote');
  if (shot) await page.screenshot({ path: `${shot}/chat-quote.png` });
  return `${q.slice(0, 20)}｜消息里带引用=${quoted}`;
});
await step('检查结果进对话：在工具页签点「检查」→ 自动切到 AI 对话、出一张检查卡片；正文没改再点不重复出卡；卡片里「让 AI 改」接着发；扫 AI 味也是卡片', async () => {
  await page.click('#sideTabTools');
  if (await page.$('#sideTools #reviewBox')) throw new Error('工具页签里不该再有检查结果');
  const before = await page.$$eval('#chatLog .chat-msg', (els) => els.length).catch(() => 0);
  await page.click('#reviewBtn');
  await page.waitForSelector('#chatPane', { state: 'visible' });
  await page.waitForFunction(() => /没发现问题|小毛病|不通顺|风险/.test(document.querySelector('#reviewVerdict')?.textContent || ''), null, { timeout: 15000 });
  const cards = await page.$$eval('#chatLog .chat-card.review', (els) => els.length);
  if (shot) await page.locator('#reviewBox').screenshot({ path: `${shot}/review-card-only.png` });
  // 正文没改：再点不出新卡，滚到上次那张
  await page.click('#reviewBtn');
  await page.waitForFunction(() => /还是上次的检查结果/.test(document.querySelector('#toast')?.textContent || ''));
  if ((await page.$$eval('#chatLog .chat-card.review', (els) => els.length)) !== cards) throw new Error('正文没改却多了一张卡');
  const btn = await page.$('#reviewBox [data-askai]');
  let said = '（演示数据没有条目，跳过让 AI 改）';
  if (btn) {
    const n = await page.$$eval('#chatLog .chat-msg', (els) => els.length);
    await btn.click();
    await page.waitForFunction((k) => document.querySelectorAll('#chatLog .chat-msg').length > k, n);
    await waitReply();
    said = (await page.textContent('#chatLog .chat-msg.user:nth-last-child(2) .chat-bubble')).trim();
    if (!/检查提示/.test(said)) throw new Error(`发出去的话不对：${said}`);
  }
  // 扫 AI 味：工具条「检查」旁的箭头
  await page.click('#reviewMore');
  await page.click('#toneScanMenu');
  await page.waitForSelector('#toneBox');
  if (shot) await page.screenshot({ path: `${shot}/review-card.png` });
  return `对话里多了 ${cards} 张检查卡片（之前 ${before} 条消息）｜${said.slice(0, 20)}`;
});
await step('检查跟着设置走：技能页打开「检查时也参考」→ 再点检查出新卡片，卡片底下标出模型和对照的技能；技能库卡片上有标记', async () => {
  const cards = await page.$$eval('#chatLog .chat-card.review', (els) => els.length);
  await page.click('#chatSkillBtn');
  await page.click('#chatSkillLib');
  await page.waitForSelector('#skillLib:not(.hidden) #skillGrid [data-skill]');
  await page.click('#skillGrid [data-skill]');
  await page.waitForSelector('#skillPage:not(.hidden) #skillInReview');
  await page.check('#skillInReview');
  const name = await page.inputValue('#skillName');
  await page.click('#skillSaveBtn');
  await page.waitForFunction(() => /已保存/.test(document.querySelector('#toast')?.textContent || ''));
  if (shot) await page.locator('#skillPage .skill-props').screenshot({ path: `${shot}/skill-in-review.png` });
  await page.click('#skillBackBtn');
  await page.waitForSelector('#skillLib:not(.hidden) .skill-review-on');
  await page.click('#skillLibBack');
  await page.waitForSelector('#skillLib.hidden', { state: 'attached' });
  // 正文没改，但参考的技能变了：重新查，出新卡
  await page.click('#reviewBtn');
  await page.waitForFunction((k) => document.querySelectorAll('#chatLog .chat-card.review').length > k, cards, { timeout: 15000 });
  await page.waitForFunction((n) => (document.querySelector('#reviewBox .card-by')?.textContent || '').includes(`对照技能：${n}`), name);
  const by = (await page.textContent('#reviewBox .card-by')).trim();
  if (!/自动/.test(by)) throw new Error(`没标出模型：${by}`);
  if (shot) await page.locator('#reviewBox').screenshot({ path: `${shot}/review-card-skill.png` });
  return by;
});
await step('话筒在输入框旁（不真开麦）；个人设置可改保存天数', async () => {
  await page.waitForSelector('#chatMicBtn', { state: 'visible' });
  await page.click('#chatKeepLink');
  await page.waitForSelector('#settingsPage:not(.hidden)');
  await page.selectOption('#settingsKeepSel', '365');
  await page.waitForFunction(() => /对话记录保存 1 年/.test(document.querySelector('#toast')?.textContent || ''));
  await page.click('#settingsCloseBtn');
  await page.waitForSelector('#settingsPage.hidden', { state: 'attached' });
  return '话筒在｜个人设置改成 1 年';
});
await step('刷新后对话记录还在，应用过的显示「已应用」，保存天数也记住了', async () => {
  // 先应用一条局部改动，看刷新后状态在不在
  const applyBtn = await page.$('#chatLog .chat-msg.assistant [data-act="apply"]');
  if (applyBtn) { await applyBtn.click(); await page.waitForTimeout(300); }
  const count = await page.$$eval('#chatLog .chat-msg', (els) => els.length);
  await page.waitForFunction(() => /已保存/.test(document.querySelector('#saveState')?.textContent || '') || !document.querySelector('#saveState'), null, { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(1500);
  await page.reload();
  await page.click('#history .history-item');
  await page.waitForSelector('#chatPane', { state: 'visible' });
  await page.waitForFunction((k) => document.querySelectorAll('#chatLog .chat-msg').length === k, count);
  const done = await page.$$eval('#chatLog .chat-done', (els) => els.length);
  await page.click('#chatKeepLink');
  await page.waitForSelector('#settingsPage:not(.hidden)');
  const keep = await page.inputValue('#settingsKeepSel');
  await page.click('#settingsCloseBtn');
  if (keep !== '365') throw new Error(`保存天数没记住：${keep}`);
  if (applyBtn && !done) throw new Error('应用状态没记住');
  return `${count} 条｜已应用/已重写 ${done} 条`;
});
await step('全屏：对话栏贴在右边仍可见；清空对话（先确认）', async () => {
  await page.click('#rtFullscreen');
  await page.waitForFunction(() => document.body.classList.contains('edit-fs-on'));
  const box = await page.$eval('#workSide', (el) => { const r = el.getBoundingClientRect(); return { x: r.x, w: r.width, vis: getComputedStyle(el).display }; });
  if (box.vis === 'none' || box.x < 900) throw new Error(`全屏对话位置不对 ${JSON.stringify(box)}`);
  if (shot) await page.screenshot({ path: `${shot}/chat-fullscreen.png` });
  await page.click('#rtFullscreen');
  await page.click('#chatClearBtn');
  await page.click('.ask [data-yes]');
  await page.waitForSelector('#chatLog .chat-empty');
  await page.reload();
  await page.click('#history .history-item');
  await page.waitForSelector('#chatLog .chat-empty');
  return `x=${Math.round(box.x)} w=${Math.round(box.w)}｜清空后刷新也是空的`;
});
console.log(log.join('\n'));
console.log('ERRORS', errors.length ? '\n' + errors.join('\n') : 'none');
await browser.close();
