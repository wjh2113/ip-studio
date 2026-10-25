/* Markdown 表格（GFM）：网页渲染、编辑器存取、Word 导出共用。
 *
 *   | 表头 | 表头 |
 *   | --- | :---: |
 *   | 单元格 | 单元格 |
 *
 * normalizeTables：以前编辑器不认表格，粘进来的表格每行之间被插了空行（行变成了段落）。
 * 只要一串竖线行里有分隔行，就把中间的空行去掉，认回成一张表；没有分隔行的竖线文字原样不动。 */

export const isRow = (line) => /^\s*\|.*\|\s*$/.test(String(line || ''));

export const isSep = (line) => {
  const s = String(line || '').trim();
  if (!isRow(s) || !s.includes('-')) return false;
  return splitRow(s).every((c) => /^:?-{3,}:?$/.test(c.replace(/\s+/g, '')));
};

/* 拆单元格：去掉两头的 |，按没转义的 | 切开，\| 还原成 | */
export function splitRow(line) {
  let s = String(line || '').trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  const cells = [];
  let cur = '';
  for (let i = 0; i < s.length; i += 1) {
    if (s[i] === '\\' && s[i + 1] === '|') { cur += '|'; i += 1; continue; }
    if (s[i] === '|') { cells.push(cur.trim()); cur = ''; continue; }
    cur += s[i];
  }
  cells.push(cur.trim());
  return cells;
}

const alignOf = (c) => {
  const t = c.replace(/\s+/g, '');
  if (t.startsWith(':') && t.endsWith(':')) return 'center';
  if (t.endsWith(':')) return 'right';
  return '';
};

/* 从第 i 行开始是不是一张表：表头 + 分隔行（+ 若干数据行）。是就返回 { header, align, rows, end }（end = 表后第一行） */
export function readTable(lines, i) {
  if (!isRow(lines[i]) || !isSep(lines[i + 1])) return null;
  const header = splitRow(lines[i]);
  const align = splitRow(lines[i + 1]).map(alignOf);
  const rows = [];
  let j = i + 2;
  while (j < lines.length && isRow(lines[j]) && !isSep(lines[j])) {
    const cells = splitRow(lines[j]);
    // 列数对齐表头：多的并进最后一格，少的补空
    while (cells.length < header.length) cells.push('');
    if (cells.length > header.length) cells.splice(header.length - 1, cells.length, cells.slice(header.length - 1).join(' | '));
    rows.push(cells);
    j += 1;
  }
  return { header, align, rows, end: j };
}

/* 把被空行隔开的表格行合回去；表格前后保证各有一个空行 */
export function normalizeTables(text) {
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    if (!isRow(lines[i])) { out.push(lines[i]); i += 1; continue; }
    // 收一串竖线行，中间允许空行
    const rows = [];
    let j = i;
    let lastRow = i;
    while (j < lines.length && (isRow(lines[j]) || !lines[j].trim())) {
      if (isRow(lines[j])) { rows.push(lines[j].trim()); lastRow = j; }
      j += 1;
    }
    if (rows.length >= 2 && isSep(rows[1])) {
      if (out.length && out[out.length - 1].trim()) out.push('');
      out.push(...rows);
      if (lastRow + 1 < lines.length) out.push('');
      i = lastRow + 1;
      while (i < lines.length && !lines[i].trim()) i += 1;     // 表后的多个空行收成一个
    } else {
      out.push(lines[i]);
      i += 1;
    }
  }
  return out.join('\n');
}

const cellText = (s) => String(s ?? '').replace(/\n+/g, ' ').replace(/\|/g, '\\|').trim();

/* { header, rows } → Markdown 表格 */
export function tableToMarkdown({ header, rows }) {
  const n = Math.max(header.length, ...rows.map((r) => r.length), 1);
  const pad = (r) => Array.from({ length: n }, (_, k) => cellText(r[k]));
  return [
    `| ${pad(header).join(' | ')} |`,
    `| ${Array(n).fill('---').join(' | ')} |`,
    ...rows.map((r) => `| ${pad(r).join(' | ')} |`),
  ].join('\n');
}
