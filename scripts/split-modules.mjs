/* One-off: split server/prompts.js and server/db.js into domain modules */
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');

function sliceLines(file, start, end) {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  return lines.slice(start - 1, end).join('\n');
}

function write(rel, content) {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
  console.log('wrote', rel);
}

// --- prompts ---
const pj = path.join(root, 'server/prompts.js');
const L = (a, b) => sliceLines(pj, a, b);

write('server/prompts/_shared.js', `${L(4, 74)}
`);

write('server/prompts/learning.js', `import { weigh, weightNote } from '../refs.js';
import { fence, DATA_NOTE } from './_shared.js';

${L(322, 339).replace(/^const styleBlock/m, 'export const styleBlock')}

${L(342, 377)}

${L(305, 320)}

${L(379, 535)}
`);

write('server/prompts/topics.js', `import { frameworkBlock } from '../frameworks.js';
import { weigh, weightNote } from '../refs.js';
import {
  DATA_NOTE, fence, platformSpec, toneSpec,
} from './_shared.js';
import { profileBlock, styleBlock } from './learning.js';

${L(76, 109)}

${L(114, 132).replace(/^const creatorBlock/m, 'export const creatorBlock')}

${L(135, 145).replace(/^const personaBlock/m, 'export const personaBlock')}

export function brief(d, persona, samples, me = null) {
  const p = platformSpec(d.platform);
  const account = personaBlock(persona);
  const creator = creatorBlock(persona);
  const profile = weigh(profileBlock(me?.profile, { compact: me?.compact }), me?.refs, 'profile');
  const style = styleBlock(persona, samples, me?.prefs, me?.refs);
  const section = sectionBlock(d.section, d.inputs);
  const framework = frameworkBlock(d.framework, d.length);
  const hot = hotspotRefBlock(d.hotspot);
  const head = [account, creator, profile, style, section, framework].filter(Boolean);
  return [
    head.join('\\n\\n') || null,
    hot ? \`\\n\${hot}\` : null,
    head.length || hot ? '\\n—— 本篇简报 ——' : null,
    \`题材：\${d.subject}\`,
    \`发布平台：\${p.label}\`,
    \`风格调性：\${d.tone} —— \${toneSpec(d.tone)}\`,
    d.audience && d.audience !== persona?.audience
      ? \`本篇聚焦读者：\${d.audience}\`
      : (persona?.audience ? null : '目标读者：由你根据题材判断'),
    d.keywords ? \`必须覆盖的关键词/信息点：\${d.keywords}\` : null,
    \`目标篇幅：约 \${d.length} 字\`,
    \`\\n平台写作规范：\\n\${p.spec}\`,
    (style || section || hot || profile) ? \`\\n\${DATA_NOTE}\` : null,
  ].filter((x) => x != null).join('\\n');
}

${L(175, 234)}

${L(691, 811)}

${L(945, 1106)}
`);

write('server/prompts/content.js', `import { weigh } from '../refs.js';
import { brief } from './topics.js';
import { materialsBlock } from './publish.js';

${L(236, 299)}
`);

write('server/prompts/assist.js', `import { HUMAN_STYLE } from './content.js';
import { platformSpec } from './_shared.js';
import { creatorBlock, personaBlock } from './topics.js';
import { profileBlock, styleBlock } from './learning.js';

${L(537, 689)}
`);

write('server/prompts/review.js', `import { frameworkBlock } from '../frameworks.js';
import { creatorBlock, personaBlock, hotspotRefBlock, sectionBlock } from './topics.js';
import { platformSpec } from './_shared.js';
import { styleBlock } from './learning.js';

${L(813, 943)}
`);

write('server/prompts/speak.js', `import { DATA_NOTE, fence, platformSpec } from './_shared.js';
import { creatorBlock } from './topics.js';

${L(1108, 1315)}
`);

write('server/prompts/publish.js', `import { IMAGE_MARK } from '../shared/place.js';
import { creatorBlock, personaBlock } from './topics.js';
import { platformSpec, fence, DATA_NOTE, PLATFORMS, TONES, GENDERS } from './_shared.js';
import { HUMAN_STYLE } from './content.js';

export { IMAGE_MARK };

${L(1326, 1370)}

${L(1383, 1517)}
`);

write('server/prompts/extract.js', `import { fence, DATA_NOTE, PLATFORMS, TONES, GENDERS } from './_shared.js';

${L(1519, 1599)}
`);

write('server/prompts/index.js', `export * from './_shared.js';
export * from './topics.js';
export * from './learning.js';
export * from './content.js';
export * from './assist.js';
export * from './review.js';
export * from './speak.js';
export * from './publish.js';
export * from './extract.js';
`);

write('server/prompts.js', `export * from './prompts/index.js';
`);

// --- db ---
const dj = path.join(root, 'server/db.js');
const D = (a, b) => sliceLines(dj, a, b);

write('server/db/_util.js', `${D(1, 43)}
export { now, one, nums, read, same, parseJson, changed };
`);

// Fix _util.js - parseJson is defined later in original at 964, need to move to _util
const utilBody = `/* 数据层：PostgreSQL + Drizzle。图片和录音仍在 DATA_DIR，不进库。 */
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { sql } from 'drizzle-orm';
import { getDatabase, orm } from '../client.js';
import { runMigrations } from '../migrations.js';
import { fromRoot } from '../paths.js';

const fileRoot = process.env.DATA_DIR
  ? resolve(process.env.DATA_DIR)
  : (process.env.DB_PATH ? dirname(resolve(process.env.DB_PATH)) : fromRoot('data'));
export const DATA_DIR = fileRoot;
mkdirSync(DATA_DIR, { recursive: true });

const opened = await getDatabase();
export const db = opened.db;
await runMigrations();

export const now = () => new Date().toISOString();
export const one = async (q) => (await q)[0] ?? null;
export const nums = (row, keys) => {
  if (!row) return row;
  const out = { ...row };
  for (const k of keys) if (out[k] != null) out[k] = Number(out[k]);
  return out;
};
export async function read(statement) {
  const result = await orm().execute(statement);
  return result.rows ?? result;
}
export const same = (col, val) => sql\`\${col} IS NOT DISTINCT FROM \${val}\`;

export const parseJson = (raw, fallback) => { try { return JSON.parse(raw); } catch { return fallback; } };

let changeHook = null;
export const onContentChanged = (fn) => { changeHook = fn; };
export const changed = (userId) => { try { changeHook?.(userId); } catch { /* 通知失败不影响写库 */ } };
`;
write('server/db/_util.js', utilBody);

write('server/db/auth.js', `import { and, asc, count, desc, eq, sql } from 'drizzle-orm';
import { withTx, orm } from '../client.js';
import { adminSessions, admins, invites, sessions, users } from '../schema.js';
import { now, one, nums, read } from './_util.js';

${D(45, 90)}

${D(173, 251)}
`);

write('server/db/billing.js', `import { and, count, desc, eq, ne, sql } from 'drizzle-orm';
import { inTransaction, orm } from '../client.js';
import { orders, settings, usageEvents, users } from '../schema.js';
import { now, one, nums, read } from './_util.js';

${D(92, 171)}

${D(386, 476)}
`);

write('server/db/admin.js', `import { and, asc, count, desc, eq, sql } from 'drizzle-orm';
import { orm } from '../client.js';
import { evalCases, evalRuns, evalVotes, promptVariants } from '../schema.js';
import { now, one, nums, read } from './_util.js';

${D(478, 555)}
`);

write('server/db/personas.js', `import { and, asc, count, desc, eq, inArray, sql } from 'drizzle-orm';
import { orm, withTx } from '../client.js';
import {
  embeddings, learnLog, personas, profileEntries, sections, stylePrefs, styleSamples,
} from '../schema.js';
import { changed, now, one, nums, parseJson, read, same } from './_util.js';

${D(253, 384)}

${D(701, 900)}

${D(902, 956)}
`);

write('server/db/drafts.js', `import { and, asc, count, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import { orm, withTx } from '../client.js';
import { draftMetrics, draftRevisions, draftVariants, drafts } from '../schema.js';
import { rebindCues, rebindIllus } from '../keep.js';
import { editRatio } from '../quality.js';
import { now, one, nums, parseJson, read, same } from './_util.js';

const gapMin = Number(process.env.REVISION_GAP_MIN);
const REVISION_GAP = (process.env.REVISION_GAP_MIN && Number.isFinite(gapMin) && gapMin >= 0 ? gapMin : 10) * 60 * 1000;
const REVISION_MAX = Math.max(5, Math.floor(Number(process.env.REVISION_MAX) || 50));

${D(966, 1002)}

${D(1537, 1601)}

${D(1004, 1310)}

${D(1312, 1358)}
`);

write('server/db/content.js', `import { and, asc, count, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import { orm, withTx } from '../client.js';
import {
  benchmarks, drafts, frameworks, inboxKeys, jobs, materials, speakTakes, syncKeys, topicPool, users,
} from '../schema.js';
import { Drafts } from './drafts.js';
import { Embeddings } from './personas.js';
import { now, one, nums, parseJson, read, same } from './_util.js';

${D(557, 660)}

${D(662, 699)}

${D(1360, 1535)}

${D(1603, 1650)}
`);

write('server/db/index.js', `import './_util.js';
export * from './_util.js';
export * from './auth.js';
export * from './billing.js';
export * from './personas.js';
export * from './drafts.js';
export * from './content.js';
export * from './admin.js';
`);

write('server/db.js', `export * from './db/index.js';
`);

console.log('done');
