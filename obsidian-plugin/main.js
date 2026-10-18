/* 自媒体助手同步（Obsidian 插件）
 *
 * 成稿：助手 → 知识库（单向增量）。
 * 素材：助手 ↔ 用户指定的素材文件夹（双向）。冲突时两边都留——本机另存副本、助手下次推送新建。
 *
 * 成稿怎么同步：
 *   - 服务端按 (更新时间, id) 增量导出，插件记住 cursor；
 *   - 用 ips_id 认文件；「我的笔记」标记以下不改。
 * 素材怎么同步：
 *   - pull：GET /api/export/materials；push：POST /api/export/materials；
 *   - 用 ips_material_id 认文件；只扫设置里的素材文件夹。
 *
 * 写成不用编译的 CommonJS（obsidian 模块由 Obsidian 运行时提供）。 */
'use strict';

const { Notice, Plugin, PluginSettingTab, Setting, normalizePath, requestUrl } = require('obsidian');

const DEFAULTS = {
  serverUrl: '',
  exportPath: '/api/export/drafts',
  materialsPath: '/api/export/materials',
  apiKey: '',
  folder: '自媒体助手',
  attachmentFolder: '自媒体助手/附件',
  materialFolder: '素材库',
  syncMaterials: true,
  intervalMinutes: 60,
  syncOnStartup: true,
  byAccount: true,
  includeVariants: true,
};
const PAGE = 50;
const NOTES_MARK = '%% 同步只更新这一行以上的内容，下面写你自己的笔记 %%';
const NOTES_HEAD = '## 我的笔记';

/* ---------------- 纯函数（也给测试用） ---------------- */

function safeName(s, max = 80) {
  const out = String(s || '')
    .replace(/[\\/:*?"<>|#^[\]\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
    .replace(/[. ]+$/, '');
  return /^(con|prn|aux|nul|com\d|lpt\d)$/i.test(out) ? `${out}_` : (out || '未命名');
}

const yamlStr = (v) => JSON.stringify(String(v ?? ''));
const tagName = (t) => String(t || '').trim().replace(/[\s#,，]+/g, '-').replace(/^-+|-+$/g, '');

function contentHash(s) {
  let h = 5381;
  const str = String(s || '');
  for (let i = 0; i < str.length; i += 1) h = ((h << 5) + h) ^ str.charCodeAt(i);
  return (h >>> 0).toString(16);
}

/* 标记线以上（不含「我的笔记」标题） */
function bodyAboveNotes(text) {
  const old = String(text || '');
  const i = old.indexOf(NOTES_MARK);
  if (i < 0) return old.trim();
  const head = old.lastIndexOf(NOTES_HEAD, i);
  const from = head >= 0 && !old.slice(head + NOTES_HEAD.length, i).trim() ? head : i;
  return old.slice(0, from).trim();
}

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

function materialFrontmatter(item) {
  const lines = [
    '---',
    `ips_material_id: ${Number(item.id)}`,
    `kind: ${yamlStr(item.kind || '文章')}`,
    `title: ${yamlStr(item.title)}`,
    `created: ${yamlStr(item.createdAt || '')}`,
    `updated: ${yamlStr(item.updatedAt || '')}`,
  ];
  const tags = (item.tags || []).map(tagName).filter(Boolean);
  lines.push(tags.length ? `tags:\n${tags.map((t) => `  - ${yamlStr(t)}`).join('\n')}` : 'tags: []');
  lines.push('source: 自媒体助手·素材', '---');
  return lines.join('\n');
}

function demote(md, n) {
  let fenced = false;
  return String(md || '').split('\n').map((line) => {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    if (fenced) return line;
    const m = line.match(/^(#{1,6})(\s.*)$/);
    return m ? `${'#'.repeat(Math.min(6, m[1].length + n))}${m[2]}` : line;
  }).join('\n');
}

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

function renderMaterialNote(item) {
  const body = String(item.markdown != null ? item.markdown : item.body || '').trim();
  return `${materialFrontmatter(item)}\n\n${body}\n`;
}

function mergeNotes(fresh, old) {
  const i = old == null ? -1 : old.indexOf(NOTES_MARK);
  if (i >= 0) {
    const head = old.lastIndexOf(NOTES_HEAD, i);
    const from = head >= 0 && !old.slice(head + NOTES_HEAD.length, i).trim() ? head : i;
    return `${fresh.trimEnd()}\n\n${old.slice(from).trimStart()}`;
  }
  return `${fresh.trimEnd()}\n\n${NOTES_HEAD}\n${NOTES_MARK}\n\n`;
}

/* 从笔记解析素材字段（给 push 用） */
function parseMaterialNote(text) {
  const raw = String(text || '');
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) {
    const body = bodyAboveNotes(raw);
    const title = body.split('\n').find((l) => l.trim()) || '未命名素材';
    return { id: null, kind: '文章', title: title.replace(/^#+\s*/, '').slice(0, 80), tags: [], body, updated: '' };
  }
  const fm = m[1];
  const rest = bodyAboveNotes(`---\n${fm}\n---\n${m[2]}`).replace(/^---\n[\s\S]*?\n---\n?/, '').trim();
  const idM = fm.match(/^ips_material_id:\s*(\d+)\s*$/m);
  const kindM = fm.match(/^kind:\s*(.+)$/m);
  const titleM = fm.match(/^title:\s*(.+)$/m);
  const updatedM = fm.match(/^updated:\s*(.+)$/m);
  const tags = [];
  const tagBlock = fm.match(/^tags:\n((?: {2}- .+\n?)*)/m);
  if (tagBlock) {
    for (const line of tagBlock[1].split('\n')) {
      const t = line.match(/^\s*-\s*(.+)$/);
      if (t) {
        let v = t[1].trim();
        try { v = JSON.parse(v); } catch { /* 裸字符串 */ }
        if (v) tags.push(String(v));
      }
    }
  }
  const unquote = (s) => {
    const t = String(s || '').trim();
    try { return JSON.parse(t); } catch { return t.replace(/^["']|["']$/g, ''); }
  };
  return {
    id: idM ? Number(idM[1]) : null,
    kind: kindM ? unquote(kindM[1]) : '文章',
    title: titleM ? unquote(titleM[1]) : (rest.split('\n')[0] || '未命名').replace(/^#+\s*/, '').slice(0, 80),
    tags,
    body: rest,
    updated: updatedM ? unquote(updatedM[1]) : '',
  };
}

/* 冲突：把本机内容另存为无 id 的副本路径名 */
function conflictLocalPath(path) {
  const p = normalizePath(path);
  if (p.endsWith('.md')) return `${p.slice(0, -3)} (本机副本).md`;
  return `${p} (本机副本).md`;
}

function noteFolder(item, s) {
  const base = normalizePath(s.folder || DEFAULTS.folder);
  return s.byAccount ? normalizePath(`${base}/${safeName(item.account?.name || '未关联账号', 40)}`) : base;
}
function noteName(item) {
  const day = String(item.publishedAt || item.createdAt || '').slice(0, 10);
  return `${day ? `${day} ` : ''}${safeName(item.title)}`;
}
function materialNoteName(item) {
  return safeName(item.title);
}

function exportUrl(s, cursor, pathKey = 'exportPath', defaultPath = DEFAULTS.exportPath) {
  let base = String(s.serverUrl || '').trim();
  const path = String(s[pathKey] || defaultPath).trim() || defaultPath;
  // 成稿接口写成完整网址、服务器地址留空时，素材相对路径也跟这个源
  if (!base) {
    for (const candidate of [s.exportPath, s.materialsPath, path]) {
      if (/^https?:\/\//i.test(String(candidate || ''))) {
        try { base = new URL(candidate).origin; break; } catch { /* 忽略 */ }
      }
    }
  }
  if (!/^https?:\/\//i.test(base) && !/^https?:\/\//i.test(path)) throw new Error('先在设置里填服务器地址（http:// 或 https:// 开头）');
  const u = new URL(path, base || undefined);
  u.searchParams.set('limit', String(PAGE));
  if (cursor) u.searchParams.set('cursor', cursor);
  return u;
}

/* ---------------- 插件 ---------------- */

class IpStudioSync extends Plugin {
  async onload() {
    const saved = (await this.loadData()) || {};
    this.settings = { ...DEFAULTS, ...(saved.settings || {}) };
    this.state = {
      cursor: '', files: {}, lastSyncAt: '', lastResult: '',
      materialCursor: '', materialFiles: {},
      ...(saved.state || {}),
    };
    if (!this.state.materialFiles || typeof this.state.materialFiles !== 'object') this.state.materialFiles = {};
    this.syncing = false;
    this.timer = null;

    this.status = this.addStatusBarItem();
    this.status.addClass('ips-status');
    this.status.onClickEvent?.(() => this.syncNow());
    this.paintStatus();

    this.addRibbonIcon('refresh-cw', '同步自媒体助手', () => this.syncNow());
    this.addCommand({ id: 'sync-now', name: '立即同步（成稿 + 素材）', callback: () => this.syncNow() });
    this.addCommand({ id: 'sync-all', name: '全部重新同步（重新拉一遍所有成稿与素材）', callback: () => this.resync() });
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
    this.status.setText(text || (at ? `助手同步 ${when}` : '助手未同步'));
    this.status.setAttr?.('aria-label', this.state.lastResult || '点一下立即同步');
  }

  async request(url, { method = 'GET', body } = {}) {
    const opts = {
      url: String(url),
      method,
      headers: { Authorization: `Bearer ${String(this.settings.apiKey || '').trim()}` },
      throw: false,
    };
    if (body != null) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = typeof body === 'string' ? body : JSON.stringify(body);
    }
    const res = await requestUrl(opts);
    if (res.status >= 400) {
      let msg = '';
      try { msg = JSON.parse(res.text).error; } catch { /* 不是 JSON */ }
      const err = new Error(msg || `服务器返回 ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return res;
  }

  async testConnection() {
    const u = exportUrl(this.settings, '');
    u.searchParams.set('limit', '1');
    const res = await this.request(u);
    return res.json?.user || JSON.parse(res.text).user || '';
  }

  async resync() {
    this.state.cursor = '';
    this.state.materialCursor = '';
    await this.save();
    await this.syncNow();
  }

  async syncNow({ quiet = false } = {}) {
    if (this.syncing) { if (!quiet) new Notice('正在同步，稍等'); return null; }
    if (!this.ready()) { if (!quiet) new Notice('先在插件设置里填服务器地址和同步密钥'); return null; }
    this.syncing = true;
    this.paintStatus('同步中…');
    const stat = { created: 0, updated: 0, renamed: 0, same: 0, images: 0, matCreated: 0, matUpdated: 0, matPushed: 0, matConflict: 0 };
    try {
      await this.pullDrafts(stat);
      if (this.settings.syncMaterials !== false) {
        await this.pullMaterials(stat);
        await this.pushMaterials(stat);
      }
      this.state.lastSyncAt = new Date().toISOString();
      const parts = [
        stat.created && `成稿新增 ${stat.created}`,
        stat.updated && `成稿更新 ${stat.updated}`,
        stat.images && `配图 ${stat.images}`,
        stat.missing && `缺图跳过 ${stat.missing}`,
        stat.matCreated && `素材拉取新建 ${stat.matCreated}`,
        stat.matUpdated && `素材拉取更新 ${stat.matUpdated}`,
        stat.matConflict && `素材冲突拆分 ${stat.matConflict}`,
        stat.matPushed && `素材推送 ${stat.matPushed}`,
      ].filter(Boolean);
      const changed = stat.created + stat.updated + stat.matCreated + stat.matUpdated + stat.matPushed + stat.matConflict;
      this.state.lastResult = changed ? parts.join('，') : '没有新的成稿或素材';
      await this.save();
      this.paintStatus();
      if (!quiet || changed) new Notice(`自媒体助手：${this.state.lastResult}`);
      return stat;
    } catch (err) {
      this.state.lastResult = `同步失败：${err.message}`;
      await this.save();
      this.paintStatus('同步失败');
      new Notice(`自媒体助手同步失败：${err.message}`, 8000);
      return null;
    } finally {
      this.syncing = false;
    }
  }

  async pullDrafts(stat) {
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
  }

  async pullMaterials(stat) {
    const baseUrl = exportUrl(this.settings, '', 'materialsPath', DEFAULTS.materialsPath);
    for (let guard = 0; guard < 1000; guard += 1) {
      const res = await this.request(exportUrl(this.settings, this.state.materialCursor, 'materialsPath', DEFAULTS.materialsPath));
      const data = res.json || JSON.parse(res.text);
      for (const item of data.items || []) {
        await this.writeMaterialItem(item, stat);
        this.state.materialCursor = `${item.updatedAt}|${item.id}`;
      }
      if (data.cursor) this.state.materialCursor = data.cursor;
      await this.save();
      if (!data.more) break;
    }
    return baseUrl;
  }

  async pushMaterials(stat) {
    const folder = normalizePath(this.settings.materialFolder || DEFAULTS.materialFolder);
    await this.ensureFolder(folder);
    const files = this.app.vault.getMarkdownFiles().filter((f) => f.path === folder || f.path.startsWith(`${folder}/`));
    const batch = [];
    const meta = [];
    for (const f of files) {
      const text = await this.app.vault.read(f);
      const parsed = parseMaterialNote(text);
      if (!parsed.body) continue;
      const hash = contentHash(bodyAboveNotes(text));
      const id = parsed.id;
      const prev = id ? this.state.materialFiles[id] : null;
      // 有 id 且相对上次同步没改 → 跳过；无 id 的（含本机副本）每次都要推，推完会写回 id
      if (id && prev && prev.hash === hash) continue;
      batch.push({
        id: id || undefined,
        kind: parsed.kind,
        title: parsed.title,
        body: parsed.body,
        tags: parsed.tags,
      });
      meta.push({ file: f, hash });
      if (batch.length >= PAGE) {
        await this.flushMaterialPush(batch, meta, stat);
        batch.length = 0;
        meta.length = 0;
      }
    }
    if (batch.length) await this.flushMaterialPush(batch, meta, stat);
  }

  async flushMaterialPush(batch, meta, stat) {
    const url = exportUrl(this.settings, '', 'materialsPath', DEFAULTS.materialsPath);
    url.search = '';
    const res = await this.request(url, { method: 'POST', body: { items: batch } });
    const data = res.json || JSON.parse(res.text);
    const results = data.results || [];
    for (let i = 0; i < results.length; i += 1) {
      const r = results[i];
      const m = meta[i];
      if (!r?.ok || !r.material || !m) continue;
      stat.matPushed += 1;
      const mat = r.material;
      const old = await this.app.vault.read(m.file);
      const next = mergeNotes(renderMaterialNote(mat), old);
      if (next !== old) await this.app.vault.modify(m.file, next);
      this.state.materialFiles[mat.id] = {
        path: m.file.path,
        hash: contentHash(bodyAboveNotes(next)),
        syncedUpdatedAt: mat.updatedAt,
      };
    }
    await this.save();
  }

  async ensureFolder(path) {
    const parts = normalizePath(path).split('/').filter(Boolean);
    let cur = '';
    for (const p of parts) {
      cur = cur ? `${cur}/${p}` : p;
      if (!this.app.vault.getAbstractFileByPath(cur)) {
        try { await this.app.vault.createFolder(cur); } catch (err) {
          if (!this.app.vault.getAbstractFileByPath(cur)) throw err;
        }
      }
    }
  }

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

  findFile(id) {
    const known = this.state.files[id] && this.app.vault.getAbstractFileByPath(this.state.files[id]);
    if (known && known.extension === 'md') return known;
    const base = normalizePath(this.settings.folder || DEFAULTS.folder);
    for (const f of this.app.vault.getMarkdownFiles()) {
      if (!f.path.startsWith(`${base}/`) && f.path !== base) continue;
      if (Number(this.app.metadataCache.getFileCache(f)?.frontmatter?.ips_id) === Number(id)) return f;
    }
    return null;
  }

  findMaterialFile(id) {
    const rec = this.state.materialFiles[id];
    const known = rec?.path && this.app.vault.getAbstractFileByPath(rec.path);
    if (known && known.extension === 'md') return known;
    const base = normalizePath(this.settings.materialFolder || DEFAULTS.materialFolder);
    for (const f of this.app.vault.getMarkdownFiles()) {
      if (f.path !== base && !f.path.startsWith(`${base}/`)) continue;
      const fm = this.app.metadataCache.getFileCache(f)?.frontmatter;
      if (Number(fm?.ips_material_id) === Number(id)) return f;
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

    const taken = this.app.vault.getAbstractFileByPath(path);
    if (taken && taken !== file) path = normalizePath(`${folder}/${noteName(item)} (${item.id}).md`);

    if (!file) {
      await this.app.vault.create(path, mergeNotes(fresh, null));
      stat.created += 1;
    } else {
      let target = file;
      if (file.path !== path) {
        await this.app.fileManager.renameFile(file, path);
        target = this.app.vault.getAbstractFileByPath(path) || file;
        stat.renamed += 1;
      }
      const old = await this.app.vault.read(target);
      const next = mergeNotes(fresh, old);
      if (next !== old) { await this.app.vault.modify(target, next); stat.updated += 1; } else stat.same += 1;
    }
    this.state.files[item.id] = path;
  }

  async writeMaterialItem(item, stat) {
    const folder = normalizePath(this.settings.materialFolder || DEFAULTS.materialFolder);
    await this.ensureFolder(folder);
    let path = normalizePath(`${folder}/${materialNoteName(item)}.md`);
    const file = this.findMaterialFile(item.id);
    const taken = this.app.vault.getAbstractFileByPath(path);
    if (taken && taken !== file) path = normalizePath(`${folder}/${materialNoteName(item)} (${item.id}).md`);

    const fresh = renderMaterialNote(item);
    const prev = this.state.materialFiles[item.id];

    if (!file) {
      const text = mergeNotes(fresh, null);
      await this.app.vault.create(path, text);
      this.state.materialFiles[item.id] = {
        path,
        hash: contentHash(bodyAboveNotes(text)),
        syncedUpdatedAt: item.updatedAt,
      };
      stat.matCreated += 1;
      return;
    }

    const old = await this.app.vault.read(file);
    const localHash = contentHash(bodyAboveNotes(old));
    const serverFresh = mergeNotes(fresh, old);
    const serverHash = contentHash(bodyAboveNotes(serverFresh));
    const localChanged = prev && localHash !== prev.hash;
    const serverChanged = !prev || prev.syncedUpdatedAt !== item.updatedAt || (prev.hash && serverHash !== prev.hash);

    if (localChanged && serverChanged && localHash !== serverHash) {
      // 冲突：本机另存无 id 副本，原路径写助手版
      let copyPath = conflictLocalPath(file.path);
      let n = 2;
      while (this.app.vault.getAbstractFileByPath(copyPath)) {
        copyPath = normalizePath(conflictLocalPath(file.path).replace(/\.md$/i, ` ${n}.md`));
        n += 1;
      }
      const localParsed = parseMaterialNote(old);
      const copyTitle = `${localParsed.title}（本机副本）`.slice(0, 80);
      const tags = (localParsed.tags || []).map(tagName).filter(Boolean);
      const copyFresh = [
        '---',
        `kind: ${yamlStr(localParsed.kind || '文章')}`,
        `title: ${yamlStr(copyTitle)}`,
        tags.length ? `tags:\n${tags.map((t) => `  - ${yamlStr(t)}`).join('\n')}` : 'tags: []',
        'source: 自媒体助手·素材',
        '---',
        '',
        localParsed.body,
      ].join('\n');
      await this.app.vault.create(copyPath, mergeNotes(copyFresh, old));

      let target = file;
      if (file.path !== path) {
        await this.app.fileManager.renameFile(file, path);
        target = this.app.vault.getAbstractFileByPath(path) || file;
      }
      await this.app.vault.modify(target, serverFresh);
      this.state.materialFiles[item.id] = {
        path: target.path,
        hash: contentHash(bodyAboveNotes(serverFresh)),
        syncedUpdatedAt: item.updatedAt,
      };
      stat.matConflict += 1;
      return;
    }

    let target = file;
    if (file.path !== path) {
      await this.app.fileManager.renameFile(file, path);
      target = this.app.vault.getAbstractFileByPath(path) || file;
    }
    if (serverFresh !== old) {
      await this.app.vault.modify(target, serverFresh);
      stat.matUpdated += 1;
    } else {
      stat.same += 1;
    }
    this.state.materialFiles[item.id] = {
      path: target.path,
      hash: contentHash(bodyAboveNotes(serverFresh)),
      syncedUpdatedAt: item.updatedAt,
    };
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
    new Setting(containerEl).setName('成稿导出接口')
      .setDesc('一般不用改')
      .addText((t) => t.setPlaceholder(DEFAULTS.exportPath).setValue(s.exportPath).onChange(set('exportPath')))
      .addExtraButton((b) => b.setIcon('reset').setTooltip('恢复默认').onClick(async () => { s.exportPath = DEFAULTS.exportPath; await p.save(); this.display(); }));
    new Setting(containerEl).setName('素材同步接口')
      .setDesc('一般不用改')
      .addText((t) => t.setPlaceholder(DEFAULTS.materialsPath).setValue(s.materialsPath || DEFAULTS.materialsPath).onChange(set('materialsPath')));
    new Setting(containerEl).setName('同步密钥')
      .setDesc('在网页「同步」里生成。可读写素材同步接口；成稿只读；不能登录、不扣额度')
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
      .setDesc('默认 60。填 0 不自动同步；最短 5 分钟')
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
    new Setting(containerEl).setName('同步素材库')
      .setDesc('关掉就只同步成稿')
      .addToggle((t) => t.setValue(s.syncMaterials !== false).onChange(set('syncMaterials')));
    new Setting(containerEl).setName('立即同步')
      .setDesc(p.state.lastSyncAt ? `上次：${new Date(p.state.lastSyncAt).toLocaleString()} · ${p.state.lastResult}` : '还没同步过')
      .addButton((b) => b.setButtonText('立即同步').setCta().onClick(async () => { await p.syncNow(); this.display(); }))
      .addButton((b) => b.setButtonText('全部重新同步').setTooltip('从头再拉成稿与素材').onClick(async () => { await p.resync(); this.display(); }));

    containerEl.createEl('h3', { text: '存放位置' });
    new Setting(containerEl).setName('成稿文件夹')
      .addText((t) => t.setPlaceholder(DEFAULTS.folder).setValue(s.folder).onChange(set('folder')));
    new Setting(containerEl).setName('配图文件夹')
      .addText((t) => t.setPlaceholder(DEFAULTS.attachmentFolder).setValue(s.attachmentFolder).onChange(set('attachmentFolder')));
    new Setting(containerEl).setName('素材文件夹')
      .setDesc('相对知识库的路径，只同步这个目录下的 .md。可自行改名')
      .addText((t) => t.setPlaceholder(DEFAULTS.materialFolder).setValue(s.materialFolder || DEFAULTS.materialFolder).onChange(set('materialFolder')));
    new Setting(containerEl).setName('按账号分子文件夹')
      .setDesc('只影响成稿')
      .addToggle((t) => t.setValue(s.byAccount).onChange(set('byAccount')));
    new Setting(containerEl).setName('包含其他平台版本')
      .addToggle((t) => t.setValue(s.includeVariants).onChange(set('includeVariants')));
    containerEl.createEl('p', {
      cls: 'ips-hint',
      text: '素材冲突时：本机改过的另存为「…(本机副本)」，原文件写成助手版；副本下次同步会在助手里新建一条。成稿仍是助手为准，笔记区保留。',
    });
  }
}

module.exports = IpStudioSync;
module.exports.helpers = {
  safeName, frontmatter, materialFrontmatter, demote, linkImages, renderNote, renderMaterialNote,
  mergeNotes, noteFolder, noteName, materialNoteName, exportUrl, parseMaterialNote, bodyAboveNotes,
  contentHash, conflictLocalPath, NOTES_MARK, NOTES_HEAD, DEFAULTS,
};
