/* 自媒体助手同步（Obsidian 插件）
 *
 * 把自媒体助手里的成稿定期写进知识库：每篇一个 .md，开头是属性（账号、平台、发布日期、标签……），
 * 配图下载到附件文件夹并嵌在原位。
 *
 * 怎么同步：
 *   - 服务端按 (更新时间, id) 增量导出，插件记住上次读到哪（cursor），下次只拿之后改过的；
 *   - 用稿子 id 认文件（属性里的 ips_id）：标题改了就改名，不会多出一份；
 *   - 文件里「我的笔记」那一行以下是你自己的，同步只改那一行以上；
 *   - 某篇的配图下载失败就停在这一篇，下次从它开始重试，不会漏。
 *
 * 写成不用编译的 CommonJS（obsidian 模块由 Obsidian 运行时提供），装的时候只要三个文件：
 * main.js、manifest.json、styles.css。不用 Node 专有的东西，手机版 Obsidian 也能跑。 */
'use strict';

const { Notice, Plugin, PluginSettingTab, Setting, normalizePath, requestUrl } = require('obsidian');

const DEFAULTS = {
  serverUrl: '',
  exportPath: '/api/export/drafts',
  apiKey: '',
  folder: '自媒体助手',
  attachmentFolder: '自媒体助手/附件',
  intervalMinutes: 60,
  syncOnStartup: true,
  byAccount: true,
  includeVariants: true,
};
const PAGE = 50;
const NOTES_MARK = '%% 同步只更新这一行以上的内容，下面写你自己的笔记 %%';
const NOTES_HEAD = '## 我的笔记';

/* ---------------- 纯函数（也给测试用） ---------------- */

/* Windows 不能出现在文件名里的字符、Obsidian 链接里有特殊含义的字符都换掉；结尾的点和空格 Windows 也不认 */
function safeName(s, max = 80) {
  const out = String(s || '')
    .replace(/[\\/:*?"<>|#^[\]\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
    .replace(/[. ]+$/, '');
  return /^(con|prn|aux|nul|com\d|lpt\d)$/i.test(out) ? `${out}_` : (out || '未命名');
}

const yamlStr = (v) => JSON.stringify(String(v ?? ''));   // JSON 字符串就是合法的 YAML 双引号字符串
const tagName = (t) => String(t || '').trim().replace(/[\s#,，]+/g, '-').replace(/^-+|-+$/g, '');

function frontmatter(item) {
  const lines = ['---', `ips_id: ${Number(item.id)}`, `title: ${yamlStr(item.title)}`];
  if (item.account?.name) lines.push(`account: ${yamlStr(item.account.name)}`);
  lines.push(`platform: ${yamlStr(item.platform?.label || item.platform?.key || '')}`);
  if (item.publishedAt) lines.push(`published: ${item.publishedAt}`);
  if (item.section) lines.push(`section: ${yamlStr(item.section)}`);
  if (item.framework) lines.push(`framework: ${yamlStr(item.framework)}`);
  if (item.archived) lines.push('archived: true');
  lines.push(`created: ${yamlStr(item.createdAt)}`, `updated: ${yamlStr(item.updatedAt)}`);
  const tags = (item.tags || []).map(tagName).filter(Boolean);
  lines.push(tags.length ? `tags:\n${tags.map((t) => `  - ${yamlStr(t)}`).join('\n')}` : 'tags: []');
  lines.push('source: 自媒体助手', '---');
  return lines.join('\n');
}

/* 其他平台版本放在二级标题下面，里面的标题整体降两级，免得和正文标题混 */
function demote(md, n) {
  let fenced = false;
  return String(md || '').split('\n').map((line) => {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    if (fenced) return line;
    const m = line.match(/^(#{1,6})(\s.*)$/);
    return m ? `${'#'.repeat(Math.min(6, m[1].length + n))}${m[2]}` : line;
  }).join('\n');
}

/* 服务端的 ![说明](ips-image:文件名) 换成知识库里的嵌入 ![[路径]]；没下载到的图去掉 */
function linkImages(md, local) {
  return String(md || '').replace(/!\[[^\]]*\]\(ips-image:([^)\s]+)\)/g, (all, name) => (local[name] ? `![[${local[name]}]]` : ''));
}

function renderNote(item, local, { includeVariants }) {
  const parts = [frontmatter(item), '', linkImages(item.markdown, local).trim()];
  const variants = includeVariants ? (item.variants || []).filter((v) => String(v.markdown || '').trim()) : [];
  if (variants.length) {
    parts.push('', '## 其他平台版本');
    for (const v of variants) parts.push('', `### ${v.label || v.key}`, '', demote(linkImages(v.markdown, local), 2).trim());
  }
  return `${parts.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`;
}

/* 新正文 + 旧文件里「我的笔记」那一段（没有就给一段空的） */
function mergeNotes(fresh, old) {
  const i = old == null ? -1 : old.indexOf(NOTES_MARK);
  if (i >= 0) {
    // 标记上面紧挨着的「## 我的笔记」标题也算用户区，一起保留
    const head = old.lastIndexOf(NOTES_HEAD, i);
    const from = head >= 0 && !old.slice(head + NOTES_HEAD.length, i).trim() ? head : i;
    return `${fresh.trimEnd()}\n\n${old.slice(from).trimStart()}`;
  }
  return `${fresh.trimEnd()}\n\n${NOTES_HEAD}\n${NOTES_MARK}\n\n`;
}

function noteFolder(item, s) {
  const base = normalizePath(s.folder || DEFAULTS.folder);
  return s.byAccount ? normalizePath(`${base}/${safeName(item.account?.name || '未关联账号', 40)}`) : base;
}
function noteName(item) {
  const day = String(item.publishedAt || item.createdAt || '').slice(0, 10);
  return `${day ? `${day} ` : ''}${safeName(item.title)}`;
}

/* 导出地址：接口路径可以是 /api/... 也可以是完整网址 */
function exportUrl(s, cursor) {
  const base = String(s.serverUrl || '').trim();
  if (!/^https?:\/\//i.test(base) && !/^https?:\/\//i.test(String(s.exportPath || ''))) throw new Error('先在设置里填服务器地址（http:// 或 https:// 开头）');
  const u = new URL(String(s.exportPath || DEFAULTS.exportPath).trim() || DEFAULTS.exportPath, base || undefined);
  u.searchParams.set('limit', String(PAGE));
  if (cursor) u.searchParams.set('cursor', cursor);
  return u;
}

/* ---------------- 插件 ---------------- */

class IpStudioSync extends Plugin {
  async onload() {
    const saved = (await this.loadData()) || {};
    this.settings = { ...DEFAULTS, ...(saved.settings || {}) };
    this.state = { cursor: '', files: {}, lastSyncAt: '', lastResult: '', ...(saved.state || {}) };
    this.syncing = false;
    this.timer = null;

    this.status = this.addStatusBarItem();
    this.status.addClass('ips-status');
    this.status.onClickEvent?.(() => this.syncNow());
    this.paintStatus();

    this.addRibbonIcon('refresh-cw', '同步自媒体助手成稿', () => this.syncNow());
    this.addCommand({ id: 'sync-now', name: '立即同步成稿', callback: () => this.syncNow() });
    this.addCommand({ id: 'sync-all', name: '全部重新同步（重新拉一遍所有成稿）', callback: () => this.resync() });
    this.addSettingTab(new SyncSettingTab(this.app, this));

    this.schedule();
    this.app.workspace.onLayoutReady(() => {
      if (this.settings.syncOnStartup && this.ready()) this.syncNow({ quiet: true });
    });
  }

  onunload() {
    if (this.timer) window.clearInterval(this.timer);
  }

  async save() {
    await this.saveData({ settings: this.settings, state: this.state });
  }

  ready() {
    return Boolean(String(this.settings.apiKey || '').trim() && (String(this.settings.serverUrl || '').trim() || /^https?:/i.test(this.settings.exportPath)));
  }

  /* 定时：0 = 不自动同步。改了间隔就重排 */
  schedule() {
    if (this.timer) window.clearInterval(this.timer);
    this.timer = null;
    const min = Number(this.settings.intervalMinutes);
    if (!Number.isFinite(min) || min <= 0) return;
    this.timer = window.setInterval(() => { if (this.ready()) this.syncNow({ quiet: true }); }, Math.max(5, min) * 60_000);
    this.registerInterval(this.timer);
  }

  paintStatus(text) {
    if (!this.status) return;
    const at = this.state.lastSyncAt ? new Date(this.state.lastSyncAt) : null;
    const when = at ? `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}` : '';
    this.status.setText(text || (at ? `成稿同步 ${when}` : '成稿未同步'));
    this.status.setAttr?.('aria-label', this.state.lastResult || '点一下立即同步');
  }

  async request(url) {
    const res = await requestUrl({
      url: String(url),
      method: 'GET',
      headers: { Authorization: `Bearer ${String(this.settings.apiKey || '').trim()}` },
      throw: false,
    });
    if (res.status >= 400) {
      let msg = '';
      try { msg = JSON.parse(res.text).error; } catch { /* 不是 JSON */ }
      const err = new Error(msg || `服务器返回 ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return res;
  }

  /* 测连接：拿一条，看密钥认不认 */
  async testConnection() {
    const u = exportUrl(this.settings, '');
    u.searchParams.set('limit', '1');
    const res = await this.request(u);
    return res.json?.user || JSON.parse(res.text).user || '';
  }

  async resync() {
    this.state.cursor = '';
    await this.save();
    await this.syncNow();
  }

  async syncNow({ quiet = false } = {}) {
    if (this.syncing) { if (!quiet) new Notice('正在同步，稍等'); return null; }
    if (!this.ready()) { if (!quiet) new Notice('先在插件设置里填服务器地址和同步密钥'); return null; }
    this.syncing = true;
    this.paintStatus('成稿同步中…');
    const stat = { created: 0, updated: 0, renamed: 0, same: 0, images: 0 };
    try {
      for (let guard = 0; guard < 1000; guard += 1) {
        const res = await this.request(exportUrl(this.settings, this.state.cursor));
        const data = res.json || JSON.parse(res.text);
        for (const item of data.items || []) {
          await this.writeItem(item, res.url || exportUrl(this.settings, ''), stat);
          this.state.cursor = `${item.updatedAt}|${item.id}`;
        }
        if (data.cursor) this.state.cursor = data.cursor;
        await this.save();
        if (!data.more) break;
      }
      this.state.lastSyncAt = new Date().toISOString();
      const changed = stat.created + stat.updated;
      const parts = [
        stat.created && `新增 ${stat.created} 篇`,
        stat.updated && `更新 ${stat.updated} 篇`,
        stat.images && `下载配图 ${stat.images} 张`,
        stat.missing && `${stat.missing} 张配图服务器上已经没有了，跳过`,
      ].filter(Boolean);
      this.state.lastResult = changed ? parts.join('，') : '没有新的成稿';
      await this.save();
      this.paintStatus();
      if (!quiet || changed) new Notice(`自媒体助手：${this.state.lastResult}`);
      return stat;
    } catch (err) {
      this.state.lastResult = `同步失败：${err.message}`;
      await this.save();
      this.paintStatus('成稿同步失败');
      new Notice(`自媒体助手同步失败：${err.message}`, 8000);
      return null;
    } finally {
      this.syncing = false;
    }
  }

  async ensureFolder(path) {
    const parts = normalizePath(path).split('/').filter(Boolean);
    let cur = '';
    for (const p of parts) {
      cur = cur ? `${cur}/${p}` : p;
      if (!this.app.vault.getAbstractFileByPath(cur)) {
        try { await this.app.vault.createFolder(cur); } catch (err) {
          if (!this.app.vault.getAbstractFileByPath(cur)) throw err;   // 别处刚建好了不算错
        }
      }
    }
  }

  /* 配图：下载过的不再下。服务器上已经没有这张图（404）就跳过、正文里去掉这张；
     别的失败（网络断了、服务器出错）才抛出，这一篇下次重试 */
  async downloadImages(item, base, stat) {
    const local = {};
    const all = [...(item.images || []), ...(this.settings.includeVariants ? (item.variants || []).flatMap((v) => v.images || []) : [])];
    if (!all.length) return local;
    const dir = normalizePath(this.settings.attachmentFolder || DEFAULTS.attachmentFolder);
    await this.ensureFolder(dir);
    for (const img of all) {
      if (local[img.name]) continue;
      const path = normalizePath(`${dir}/ips-${item.id}-${safeName(img.name, 120)}`);
      if (!this.app.vault.getAbstractFileByPath(path)) {
        let res;
        try {
          res = await this.request(new URL(img.url, base));
        } catch (err) {
          if (err.status === 404) { stat.missing = (stat.missing || 0) + 1; continue; }
          throw err;
        }
        await this.app.vault.createBinary(path, res.arrayBuffer);
        stat.images += 1;
      }
      local[img.name] = path;
    }
    return local;
  }

  /* 按 id 找这篇之前写到哪了：先看记录，再按属性 ips_id 在文件夹里找（被你挪过位置也认得） */
  findFile(id) {
    const known = this.state.files[id] && this.app.vault.getAbstractFileByPath(this.state.files[id]);
    if (known && known.extension === 'md') return known;
    const base = normalizePath(this.settings.folder || DEFAULTS.folder);
    for (const f of this.app.vault.getMarkdownFiles()) {
      if (!f.path.startsWith(`${base}/`)) continue;
      if (Number(this.app.metadataCache.getFileCache(f)?.frontmatter?.ips_id) === Number(id)) return f;
    }
    return null;
  }

  async writeItem(item, base, stat) {
    const local = await this.downloadImages(item, base, stat);
    const fresh = renderNote(item, local, this.settings);
    const folder = noteFolder(item, this.settings);
    await this.ensureFolder(folder);
    let path = normalizePath(`${folder}/${noteName(item)}.md`);
    const file = this.findFile(item.id);

    // 目标路径被别的文件占了（同名的另一篇）：后面加 id 区分
    const taken = this.app.vault.getAbstractFileByPath(path);
    if (taken && taken !== file) path = normalizePath(`${folder}/${noteName(item)} (${item.id}).md`);

    if (!file) {
      await this.app.vault.create(path, mergeNotes(fresh, null));
      stat.created += 1;
    } else {
      let target = file;
      if (file.path !== path) {
        await this.app.fileManager.renameFile(file, path);   // 用 fileManager 改名，别的笔记里指向它的链接一起改
        target = this.app.vault.getAbstractFileByPath(path) || file;
        stat.renamed += 1;
      }
      const old = await this.app.vault.read(target);
      const next = mergeNotes(fresh, old);
      if (next !== old) { await this.app.vault.modify(target, next); stat.updated += 1; } else stat.same += 1;
    }
    this.state.files[item.id] = path;
  }
}

/* ---------------- 设置页 ---------------- */

class SyncSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    const p = this.plugin;
    const s = p.settings;
    const set = (key, after) => async (v) => { s[key] = v; await p.save(); if (after) after(); };
    containerEl.empty();
    containerEl.addClass('ips-settings');

    containerEl.createEl('h3', { text: '连接' });
    new Setting(containerEl).setName('服务器地址')
      .setDesc('自媒体助手的网址，例如 https://ip.aidigitcloud.cn')
      .addText((t) => t.setPlaceholder('https://…').setValue(s.serverUrl).onChange(set('serverUrl')));
    new Setting(containerEl).setName('导出接口')
      .setDesc('一般不用改。可以写路径（接在服务器地址后面），也可以写完整网址')
      .addText((t) => t.setPlaceholder(DEFAULTS.exportPath).setValue(s.exportPath).onChange(set('exportPath')))
      .addExtraButton((b) => b.setIcon('reset').setTooltip('恢复默认').onClick(async () => { s.exportPath = DEFAULTS.exportPath; await p.save(); this.display(); }));
    new Setting(containerEl).setName('同步密钥')
      .setDesc('在网页右上角「同步」里生成，ips_ 开头。只能读成稿')
      .addText((t) => {
        t.inputEl.type = 'password';
        t.setPlaceholder('ips_…').setValue(s.apiKey).onChange(set('apiKey'));
      });
    new Setting(containerEl).setName('检查连接')
      .addButton((b) => b.setButtonText('测试').onClick(async () => {
        b.setDisabled(true);
        try { new Notice(`连接成功：账号 ${await p.testConnection()}`); } catch (err) { new Notice(`连不上：${err.message}`, 8000); }
        b.setDisabled(false);
      }));

    containerEl.createEl('h3', { text: '同步' });
    new Setting(containerEl).setName('自动同步间隔（分钟）')
      .setDesc('默认 60。填 0 不自动同步，只在启动时或手动同步；最短 5 分钟')
      .addText((t) => {
        t.inputEl.type = 'number';
        t.inputEl.min = '0';
        t.setValue(String(s.intervalMinutes)).onChange(async (v) => {
          const n = Math.max(0, Math.floor(Number(v)));
          s.intervalMinutes = Number.isFinite(n) ? n : DEFAULTS.intervalMinutes;
          await p.save();
          p.schedule();
        });
      });
    new Setting(containerEl).setName('打开 Obsidian 时先同步一次')
      .addToggle((t) => t.setValue(s.syncOnStartup).onChange(set('syncOnStartup')));
    new Setting(containerEl).setName('立即同步')
      .setDesc(p.state.lastSyncAt ? `上次：${new Date(p.state.lastSyncAt).toLocaleString()} · ${p.state.lastResult}` : '还没同步过')
      .addButton((b) => b.setButtonText('立即同步').setCta().onClick(async () => { await p.syncNow(); this.display(); }))
      .addButton((b) => b.setButtonText('全部重新同步').setTooltip('从头再拉一遍所有成稿（已有的文件就地更新，你的笔记保留）').onClick(async () => { await p.resync(); this.display(); }));

    containerEl.createEl('h3', { text: '存放位置' });
    new Setting(containerEl).setName('成稿文件夹')
      .addText((t) => t.setPlaceholder(DEFAULTS.folder).setValue(s.folder).onChange(set('folder')));
    new Setting(containerEl).setName('配图文件夹')
      .addText((t) => t.setPlaceholder(DEFAULTS.attachmentFolder).setValue(s.attachmentFolder).onChange(set('attachmentFolder')));
    new Setting(containerEl).setName('按账号分子文件夹')
      .setDesc('关掉就都放在成稿文件夹里')
      .addToggle((t) => t.setValue(s.byAccount).onChange(set('byAccount')));
    new Setting(containerEl).setName('包含其他平台版本')
      .setDesc('改写过的平台版本放在正文后面「其他平台版本」下')
      .addToggle((t) => t.setValue(s.includeVariants).onChange(set('includeVariants')));
    containerEl.createEl('p', {
      cls: 'ips-hint',
      text: '改了文件夹或这两个开关，只影响之后更新的成稿；想让已同步的也按新规则放，点「全部重新同步」。每篇末尾「我的笔记」以下是你自己的，同步不会改。',
    });
  }
}

module.exports = IpStudioSync;
module.exports.helpers = { safeName, frontmatter, demote, linkImages, renderNote, mergeNotes, noteFolder, noteName, exportUrl, NOTES_MARK };
