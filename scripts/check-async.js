/* 查「异步函数调用漏了 await」这一类错误（check.js 调用，也可以单独 node scripts/check-async.js）。
 *
 * 数据层从同步改成异步之后，漏掉 await 的地方不会报语法错，单测也常常测不到，
 * 线上表现是：接口 500（对 Promise 调 .map / .trim）、存进库里的是 {}、该等的没等。
 * 没有 TypeScript 的 no-floating-promises，这里用几条针对性的规则兜底：
 *   1. 数据层对象的异步方法（export const Users = { async byId() {...} } 这种）被调用时，
 *      前面没有 await / return / void，也不在 Promise.all 里；
 *   2. 项目里 export 的 async 函数被调用时同上（名字足够具体的才查，避免误报）；
 *   3. 对异步调用的结果直接 .map / .filter / .length / .trim …（包括 await X().map——await 比 .map 绑定得晚）；
 *   4. `const f = async (...) =>` 函数体里一个 await 都没有：多半是不该写成 async（放进 .map 就成了一组 Promise）。
 * 故意为之的地方，在那一行末尾加注释 `// no-await-ok` 跳过。 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT } from '../server/paths.js';

const GENERIC = new Set([
  'list', 'get', 'set', 'add', 'create', 'update', 'remove', 'delete', 'run', 'all', 'one', 'close', 'end',
  'save', 'status', 'json', 'send', 'query', 'exec', 'then', 'catch', 'finally', 'map', 'filter',
]);
const SAFE_BEFORE = /(\bawait|\breturn|\bvoid|\byield|=>)\s*[(\s]*$/;
const USE_AFTER = /^\s*\.\s*(map|filter|find|findIndex|some|every|forEach|reduce|slice|trim|length|join|includes|split|replace|toLowerCase|toUpperCase|startsWith|endsWith)\b/;

function collect(dirs) {
  const files = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (name === 'node_modules' || name === 'assets') continue;
      if (statSync(p).isDirectory()) walk(p);
      else if (name.endsWith('.js')) files.push(p);
    }
  };
  for (const d of dirs) { try { walk(join(ROOT, d)); } catch { /* 目录不存在 */ } }
  return files;
}

/* 去掉注释和字符串内容（保留长度和换行），避免注释、文案里的字样被当成代码 */
function stripCode(src) {
  let out = '';
  let i = 0;
  let mode = null;
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (mode === 'line') { if (c === '\n') { mode = null; out += c; } else out += ' '; i += 1; continue; }
    if (mode === 'block') { if (c === '*' && n === '/') { mode = null; out += '  '; i += 2; continue; } out += c === '\n' ? c : ' '; i += 1; continue; }
    if (mode) {
      if (c === '\\') { out += '  '; i += 2; continue; }
      if (c === mode) { mode = null; out += c; i += 1; continue; }
      if (mode === '`' && c === '$' && n === '{') {
        // 模板字符串里的 ${...} 是代码：原样保留到配对的 }
        let depth = 1; let j = i + 2;
        while (j < src.length && depth) { if (src[j] === '{') depth += 1; else if (src[j] === '}') depth -= 1; j += 1; }
        out += src.slice(i, j); i = j; continue;
      }
      out += c === '\n' ? c : ' '; i += 1; continue;
    }
    if (c === '/' && n === '/') { mode = 'line'; out += '  '; i += 2; continue; }
    if (c === '/' && n === '*') { mode = 'block'; out += '  '; i += 2; continue; }
    if (c === '\'' || c === '"' || c === '`') { mode = c; out += c; i += 1; continue; }
    out += c; i += 1;
  }
  return out;
}

/* 从调用的 ( 开始找配对的 )，返回之后的位置 */
function closeParen(code, open) {
  let depth = 0;
  for (let j = open; j < code.length; j += 1) {
    if (code[j] === '(') depth += 1;
    else if (code[j] === ')') { depth -= 1; if (!depth) return j + 1; }
  }
  return code.length;
}

/* 这个位置是不是在 Promise.all( / Promise.allSettled( 的括号里 */
function insidePromiseAll(code, pos) {
  const head = code.slice(Math.max(0, pos - 400), pos);
  const m = [...head.matchAll(/Promise\.(all|allSettled|race|any)\s*\(/g)].pop();
  if (!m) return false;
  const start = pos - head.length + m.index + m[0].length - 1;
  return closeParen(code, start) > pos;
}

export function checkAsync(dirs = ['server', 'scripts']) {
  const files = collect(dirs);
  const code = Object.fromEntries(files.map((f) => [f, stripCode(readFileSync(f, 'utf8'))]));
  const raw = Object.fromEntries(files.map((f) => [f, readFileSync(f, 'utf8')]));

  // 数据层对象的异步方法：export const X = { ... async m( ... }
  const daoMethods = new Map();                          // 'Users' → Set(['byId', ...])
  const asyncFns = new Set();                            // export 的 async 函数名
  for (const src of Object.values(code)) {
    for (const m of src.matchAll(/export const (\w+) = \{([\s\S]*?)\n\};/g)) {
      const methods = new Set([...m[2].matchAll(/\n\s+async\s+(\w+)\s*\(/g)].map((x) => x[1]));
      if (methods.size) daoMethods.set(m[1], methods);
    }
    for (const m of src.matchAll(/export\s+async\s+function\s+(\w+)/g)) asyncFns.add(m[1]);
    for (const m of src.matchAll(/export\s+const\s+(\w+)\s*=\s*async\b/g)) asyncFns.add(m[1]);
  }

  const problems = [];
  const lineOf = (src, pos) => src.slice(0, pos).split('\n').length;
  const skip = (f, line) => /no-await-ok/.test(raw[f].split('\n')[line - 1] || '');
  const report = (f, pos, msg) => {
    const line = lineOf(code[f], pos);
    if (!skip(f, line)) problems.push(`${relative(ROOT, f)}:${line}: ${msg}`);
  };

  for (const [f, src] of Object.entries(code)) {
    const calls = [];
    for (const [obj, methods] of daoMethods) {
      for (const m of src.matchAll(new RegExp(`\\b${obj}\\.(\\w+)\\s*\\(`, 'g'))) {
        if (methods.has(m[1])) calls.push({ pos: m.index, open: m.index + m[0].length - 1, name: `${obj}.${m[1]}` });
      }
    }
    // 这个文件里能直接调用的异步函数：项目 export 的（名字够具体的）、import 时改了名的、本文件自己定义的
    const names = new Set([...asyncFns].filter((n) => !GENERIC.has(n) && n.length >= 5));
    // import 语句要看原文：stripCode 把字符串里的路径抹掉了
    for (const m of raw[f].matchAll(/import\s*\{([^}]*)\}\s*from\s*'\.[^']*'/g)) {
      for (const part of m[1].split(',')) {
        const [orig, alias] = part.trim().split(/\s+as\s+/);
        if (alias && asyncFns.has(orig)) names.add(alias.trim());
      }
    }
    for (const m of src.matchAll(/(?:^|\n)\s*(?:async\s+function\s+(\w+)|(?:const|let)\s+(\w+)\s*=\s*async\b)/g)) {
      const n = m[1] || m[2];
      if (!GENERIC.has(n)) names.add(n);
    }
    for (const name of names) {
      for (const m of src.matchAll(new RegExp(`(?<![.\\w])${name}\\s*\\(`, 'g'))) {
        const before = src.slice(Math.max(0, m.index - 40), m.index);
        if (/(function|async)\s*$/.test(before) || /\bexport\s+(async\s+)?function\s+$/.test(before)) continue;
        calls.push({ pos: m.index, open: m.index + m[0].length - 1, name });
      }
    }

    for (const c of calls) {
      const end = closeParen(src, c.open);
      const after = src.slice(end, end + 40);
      if (USE_AFTER.test(after)) {
        report(f, c.pos, `${c.name}() 是异步的，结果直接接了 ${after.trim().split(/[^.\w]/)[0] || after.trim().slice(0, 12)}——要先 (await ${c.name}(...))`);
        continue;
      }
      const lineStart = src.lastIndexOf('\n', c.pos) + 1;
      let before = src.slice(lineStart, c.pos);
      // 调用写在续行上（上一行以 ( 或 , 结尾），把上一行也算进来
      if (/^\s*$/.test(before)) {
        const prevStart = src.lastIndexOf('\n', lineStart - 2) + 1;
        before = src.slice(prevStart, c.pos);
      }
      if (SAFE_BEFORE.test(before)) continue;
      if (insidePromiseAll(src, c.pos)) continue;
      // 当作 .then / .catch 链的开头（fire-and-forget 但显式处理了拒绝）
      if (/^\s*\.\s*(then|catch|finally)\b/.test(after)) continue;
      report(f, c.pos, `${c.name}() 是异步的，这里没有 await（要故意不等，写成 void ${c.name}(...).catch(...)）`);
    }

    // 规则 4：async 箭头函数体里没有 await
    for (const m of src.matchAll(/(?:const|let)\s+(\w+)\s*=\s*async\s*(\([^)]*\)|\w+)\s*=>\s*/g)) {
      const start = m.index + m[0].length;
      let body;
      if (src[start] === '{') {
        let depth = 0; let j = start;
        for (; j < src.length; j += 1) { if (src[j] === '{') depth += 1; else if (src[j] === '}') { depth -= 1; if (!depth) break; } }
        body = src.slice(start, j);
      } else {
        const nl = src.indexOf(';\n', start);
        body = src.slice(start, nl === -1 ? src.length : nl);
      }
      if (!/\bawait\b/.test(body)) report(f, m.index, `${m[1]} 写成了 async，但里面没有 await：多半不该是 async（放进 .map 会变成一组 Promise）`);
    }
  }
  return problems;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const problems = checkAsync(process.argv.slice(2).length ? process.argv.slice(2) : undefined);
  if (problems.length) {
    console.error(problems.join('\n'));
    console.error(`\n异步检查未通过：${problems.length} 处`);
    process.exit(1);
  }
  console.log('异步检查通过');
}
