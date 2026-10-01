/* 零依赖的代码检查：npm test 先跑它，部署脚本再跑 npm test。
 *   1. 每个 .js 过一遍 node --check（语法错误在上线前拦下）
 *   2. 项目是 ESM（package.json type: module），.js 里出现 require( 一定是 bug——
 *      pay.js 曾经就是这样：一接真实支付就 ReferenceError
 *   3. 不许留 debugger
 *   4. 异步调用漏了 await（规则见 scripts/check-async.js）
 *   5. 前端 web/ 目录：.js 同样过语法检查；.vue 用 Vue 自带的编译器把模板和脚本编一遍
 *      （拼错的指令、没闭合的标签、脚本语法错误在这里就拦下，不用等 vite build），
 *      并且模板最外层不许以注释开头（注释会让组件变成多个根节点，v-show 和传进来的 class 都失效）
 * 以后装得上 ESLint 时可以换成它；这几条规则到时照搬即可。 */
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { ROOT } from '../server/paths.js';
import { checkAsync } from './check-async.js';

const DIRS = ['server', 'shared', 'public', 'tests', 'scripts', 'web'];
const files = [];
const vueFiles = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (name === 'node_modules') continue;
    // 构建产物不查（vite 输出的压缩代码）
    if ((name === 'assets' || name === 'app') && dir.endsWith('/public')) continue;
    if (statSync(p).isDirectory()) walk(p);
    else if (name.endsWith('.js')) files.push(p);
    else if (name.endsWith('.vue')) vueFiles.push(p);
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

problems.push(...checkAsync(['server', 'scripts']));
problems.push(...await checkVue(vueFiles));

/* .vue：解析 → 编脚本（含模板）。vue 是开发依赖，没装（比如服务器上只装了运行依赖）就跳过 */
async function checkVue(list) {
  if (!list.length) return [];
  let sfc;
  try { sfc = await import('vue/compiler-sfc'); } catch { return []; }
  const out = [];
  for (const f of list) {
    const rel = relative(ROOT, f);
    const { descriptor, errors } = sfc.parse(readFileSync(f, 'utf8'), { filename: f });
    if (errors.length) { out.push(`${rel}: ${errors[0].message}`); continue; }
    // 模板最前面是注释的话，组件就有了两个根节点（注释也算）：v-show、外面传的 class / id 都会落空
    if (descriptor.template && /^\s*<!--/.test(descriptor.template.content)) {
      out.push(`${rel}: 模板最外层不要以注释开头，把注释挪进根元素里面`);
    }
    try {
      const id = rel.replace(/\W/g, '');
      if (descriptor.script || descriptor.scriptSetup) {
        const r = sfc.compileScript(descriptor, { id, inlineTemplate: true });
        execFileSync(process.execPath, ['--input-type=module', '--check'], { input: r.content, stdio: 'pipe' });
      } else if (descriptor.template) {
        const t = sfc.compileTemplate({ source: descriptor.template.content, filename: f, id });
        if (t.errors.length) out.push(`${rel}: ${t.errors[0].message || t.errors[0]}`);
      }
    } catch (err) {
      out.push(`${rel}: ${String(err.stderr || err.message).trim().split('\n').slice(0, 4).join('\n')}`);
    }
  }
  return out;
}

if (problems.length) {
  console.error(problems.join('\n'));
  console.error(`\n检查未通过：${problems.length} 处`);
  process.exit(1);
}
console.log(`检查通过：${files.length} 个 .js、${vueFiles.length} 个 .vue`);
