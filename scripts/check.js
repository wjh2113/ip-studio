/* 零依赖的代码检查：npm test 先跑它，部署脚本再跑 npm test。
 *   1. 每个 .js 过一遍 node --check（语法错误在上线前拦下）
 *   2. 项目是 ESM（package.json type: module），.js 里出现 require( 一定是 bug——
 *      pay.js 曾经就是这样：一接真实支付就 ReferenceError
 *   3. 不许留 debugger
 * 以后装得上 ESLint 时可以换成它；这几条规则到时照搬即可。 */
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { ROOT } from '../server/paths.js';

const DIRS = ['server', 'public', 'tests', 'scripts'];
const files = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (name.endsWith('.js')) files.push(p);
  }
};
for (const d of DIRS) { try { walk(join(ROOT, d)); } catch { /* 目录不存在 */ } }

const problems = [];
for (const f of files) {
  const rel = relative(ROOT, f);
  try {
    execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' });
  } catch (err) {
    problems.push(`${rel}: 语法错误\n${String(err.stderr || err.message).trim()}`);
    continue;
  }
  readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
    // 注释行不算：块注释里的 * 开头行、/* 开头行、// 之后的内容
    const code = /^\s*(\*|\/\*)/.test(line) ? '' : line.replace(/\/\/.*$/, '');
    if (/(^|[^.\w])require\s*\(/.test(code) && !/['"`].*require\s*\(.*['"`]/.test(code)) {
      problems.push(`${rel}:${i + 1}: ESM 里不能用 require()，改成 import`);
    }
    if (/^\s*debugger\s*;?\s*$/.test(code)) problems.push(`${rel}:${i + 1}: 留下了 debugger`);
  });
}

if (problems.length) {
  console.error(problems.join('\n'));
  console.error(`\n检查未通过：${problems.length} 处`);
  process.exit(1);
}
console.log(`检查通过：${files.length} 个文件`);
