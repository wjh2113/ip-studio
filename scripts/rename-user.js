/* 改用户名：node scripts/rename-user.js 旧名字 新名字
 *
 * 内容（账号设定、稿子、素材、口播记录……）都挂在用户 id 上，改名不动任何数据；之后用新名字 + 原密码登录。
 * 在服务器上跑，读和服务端一样的 .env 连数据库。
 * 注意：如果还配着访问密码 ACCESS_PASSWORD，共用账号由 ACCESS_USER（默认 ip）指定——
 * 把它改了名，下次启动会按旧名字再建一个空账号。所以先去掉 ACCESS_PASSWORD 再改。 */
import { loadEnv } from '../server/env.js';

loadEnv();
const [from, to] = process.argv.slice(2).map((x) => String(x || '').trim());
if (!from || !to) {
  console.error('用法：node scripts/rename-user.js 旧名字 新名字');
  process.exit(1);
}
const { validateCredentials, accessGateOn, accessUsername } = await import('../server/auth.js');
const { Users } = await import('../server/db.js');
const { closeDb } = await import('../server/client.js');

const bad = validateCredentials(to, 'xxxxxx');
if (bad) { console.error(bad); process.exit(1); }
if (accessGateOn() && from === accessUsername()) {
  console.error(`「${from}」现在是访问密码的共用账号（ACCESS_PASSWORD 还开着）。先在 .env 里去掉 ACCESS_PASSWORD 再改名，不然下次启动会再建一个空的「${from}」。`);
  process.exit(1);
}
const user = await Users.byName(from);
if (!user) { console.error(`没有用户「${from}」`); process.exit(1); }
if (await Users.byName(to)) { console.error(`「${to}」已经有人用了`); process.exit(1); }
await Users.rename(user.id, to);
console.log(`已改名：${from} → ${to}（用户 id ${user.id}，内容不变，用原密码登录）`);
await closeDb();
process.exit(0);
