/* 表结构（Drizzle）。列名沿用原来的蛇形，读出来的字段和以前的 SQLite 行一致。
 * 改表请在 migrations.js 末尾追加编号迁移，并在这里同步字段。 */
import { sql } from 'drizzle-orm';
import { doublePrecision, index, integer, pgTable, primaryKey, real, text, uniqueIndex, bigint } from 'drizzle-orm/pg-core';

const id = () => integer('id').primaryKey().generatedAlwaysAsIdentity();

export const users = pgTable('users', {
  id: id(),
  username: text('username').notNull().unique(),
  pass_hash: text('pass_hash').notNull(),
  created_at: text('created_at').notNull(),
  plan: text('plan').notNull().default('free'),
  period: text('period').notNull().default(''),
  used: integer('used').notNull().default(0),
  avatar_credits: integer('avatar_credits').notNull().default(0),
});

export const sessions = pgTable('sessions', {
  token: text('token').primaryKey(),
  user_id: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  expires_at: bigint('expires_at', { mode: 'number' }).notNull(),
}, (t) => [index('idx_sessions_user').on(t.user_id)]);

export const admins = pgTable('admins', {
  id: id(),
  username: text('username').notNull().unique(),
  pass_hash: text('pass_hash').notNull(),
  created_at: text('created_at').notNull(),
  last_login: text('last_login').notNull().default(''),
});

export const adminSessions = pgTable('admin_sessions', {
  token: text('token').primaryKey(),
  admin_id: integer('admin_id').notNull().references(() => admins.id, { onDelete: 'cascade' }),
  expires_at: bigint('expires_at', { mode: 'number' }).notNull(),
});

export const personas = pgTable('personas', {
  id: id(),
  user_id: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  platform: text('platform').notNull(),
  tone: text('tone').notNull(),
  content_focus: text('content_focus').notNull().default(''),
  audience: text('audience').notNull().default(''),
  problem: text('problem').notNull().default(''),
  notes: text('notes').notNull().default(''),
  creator_age: text('creator_age').notNull().default(''),
  creator_gender: text('creator_gender').notNull().default(''),
  creator_industry: text('creator_industry').notNull().default(''),
  creator_role: text('creator_role').notNull().default(''),
  creator_traits: text('creator_traits').notNull().default(''),
  style_digest: text('style_digest').notNull().default(''),
  style_updated_at: text('style_updated_at').notNull().default(''),
  auto_learn: integer('auto_learn').notNull().default(1),            // 迁移 8：发布后自动学
  digest_full_count: integer('digest_full_count').notNull().default(0), // 上次从头梳理档案时有几篇样本
  digest_full_at: text('digest_full_at').notNull().default(''),        // 迁移 9：上次从头梳理的时间
  subject_ideas: text('subject_ideas').notNull().default('[]'),
  hotspot_json: text('hotspot_json').notNull().default('null'),
  created_at: text('created_at').notNull(),
  updated_at: text('updated_at').notNull(),
}, (t) => [index('idx_personas_user').on(t.user_id, t.id)]);

export const sections = pgTable('sections', {
  id: id(),
  user_id: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  persona_id: integer('persona_id').notNull().references(() => personas.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  purpose: text('purpose').notNull().default(''),
  guide: text('guide').notNull().default(''),
  fields_json: text('fields_json').notNull().default('[]'),
  default_framework: text('default_framework').notNull().default(''),
  sort: integer('sort').notNull().default(0),
  created_at: text('created_at').notNull(),
  updated_at: text('updated_at').notNull(),
}, (t) => [index('idx_sections_persona').on(t.persona_id, t.sort, t.id)]);

export const styleSamples = pgTable('style_samples', {
  id: id(),
  user_id: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  persona_id: integer('persona_id').notNull().references(() => personas.id, { onDelete: 'cascade' }),
  draft_id: integer('draft_id'),
  title: text('title').notNull().default(''),
  content: text('content').notNull(),
  created_at: text('created_at').notNull(),
  notes: text('notes').notNull().default(''),          // 迁移 8：这一篇单独提炼的写作习惯
  source: text('source').notNull().default('manual'),  // manual | published | import | quickstart
  weight: doublePrecision('weight').notNull().default(1),
}, (t) => [index('idx_samples_persona').on(t.persona_id, t.id)]);

export const drafts = pgTable('drafts', {
  id: id(),
  user_id: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  subject: text('subject').notNull(),
  platform: text('platform').notNull(),
  tone: text('tone').notNull(),
  audience: text('audience').notNull().default(''),
  keywords: text('keywords').notNull().default(''),
  length: integer('length').notNull().default(800),
  topics_json: text('topics_json').notNull().default('[]'),
  chosen: integer('chosen'),
  title: text('title').notNull().default(''),
  content: text('content').notNull().default(''),
  status: text('status').notNull().default('topics'),
  persona_id: integer('persona_id').references(() => personas.id, { onDelete: 'set null' }),
  persona_json: text('persona_json').notNull().default('null'),
  hotspot_json: text('hotspot_json').notNull().default('null'),
  section_id: integer('section_id').references(() => sections.id, { onDelete: 'set null' }),
  section_json: text('section_json').notNull().default('null'),
  inputs_json: text('inputs_json').notNull().default('null'),
  archived_at: text('archived_at').notNull().default(''),
  cues_json: text('cues_json').notNull().default('null'),
  variants_json: text('variants_json').notNull().default('null'),
  illus_json: text('illus_json').notNull().default('null'),
  framework_json: text('framework_json').notNull().default('null'),
  metrics_json: text('metrics_json').notNull().default('null'),
  published_at: text('published_at').notNull().default(''),
  generated: text('generated').notNull().default(''),
  gen_variant: text('gen_variant').notNull().default(''),
  edit_ratio: doublePrecision('edit_ratio'),
  review_json: text('review_json').notNull().default('null'),
  context_json: text('context_json').notNull().default('null'),   // 迁移 8：成稿时参考了哪些经历、范文、素材、偏好
  learned_at: text('learned_at').notNull().default(''),           // 迁移 8：从这篇的改稿里学过偏好
  created_at: text('created_at').notNull(),
  updated_at: text('updated_at').notNull(),
}, (t) => [
  index('idx_drafts_user').on(t.user_id, t.id),
  index('idx_drafts_persona').on(t.user_id, t.persona_id, t.id),
]);

export const speakTakes = pgTable('speak_takes', {
  id: id(),
  user_id: integer('user_id').notNull(),
  draft_id: integer('draft_id'),
  title: text('title').notNull().default(''),
  script: text('script').notNull().default(''),
  cues_json: text('cues_json').notNull().default('null'),
  file: text('file').notNull().default(''),
  mime: text('mime').notNull().default(''),
  bytes: integer('bytes').notNull().default(0),
  transcript: text('transcript').notNull().default(''),
  review_json: text('review_json').notNull().default('null'),
  status: text('status').notNull().default('running'),
  error: text('error').notNull().default(''),
  created_at: text('created_at').notNull(),
}, (t) => [index('idx_speaks_user').on(t.user_id, t.id)]);

export const materials = pgTable('materials', {
  id: id(),
  user_id: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  persona_id: integer('persona_id').references(() => personas.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull().default('文章'),
  title: text('title').notNull(),
  body: text('body').notNull().default(''),
  tags: text('tags').notNull().default(''),
  used_count: integer('used_count').notNull().default(0),
  created_at: text('created_at').notNull(),
  updated_at: text('updated_at').notNull(),
}, (t) => [index('idx_materials_persona').on(t.user_id, t.persona_id, t.id)]);

export const topicPool = pgTable('topic_pool', {
  id: id(),
  user_id: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  persona_id: integer('persona_id').references(() => personas.id, { onDelete: 'cascade' }),
  subject: text('subject').notNull(),
  note: text('note').notNull().default(''),
  source: text('source').notNull().default('手动'),
  plan_date: text('plan_date').notNull().default(''),
  draft_id: integer('draft_id').references(() => drafts.id, { onDelete: 'set null' }),
  status: text('status').notNull().default('idea'),
  created_at: text('created_at').notNull(),
}, (t) => [index('idx_pool_persona').on(t.user_id, t.persona_id, t.id)]);

export const frameworks = pgTable('frameworks', {
  id: id(),
  user_id: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull().default('structure'),
  name: text('name').notNull(),
  summary: text('summary').notNull().default(''),
  platforms: text('platforms').notNull().default('[]'),
  scenes: text('scenes').notNull().default('[]'),
  slots_json: text('slots_json').notNull().default('[]'),
  detail: text('detail').notNull().default(''),
  example: text('example').notNull().default(''),
  source_text: text('source_text').notNull().default(''),
  from_key: text('from_key').notNull().default(''),
  used_count: integer('used_count').notNull().default(0),
  created_at: text('created_at').notNull(),
  updated_at: text('updated_at').notNull(),
}, (t) => [index('idx_frameworks_user').on(t.user_id, t.id)]);

export const draftRevisions = pgTable('draft_revisions', {
  id: id(),
  draft_id: integer('draft_id').notNull(),
  user_id: integer('user_id').notNull(),
  content: text('content').notNull(),
  created_at: text('created_at').notNull(),
}, (t) => [index('idx_draft_rev').on(t.draft_id, t.user_id, t.id)]);

export const draftMetrics = pgTable('draft_metrics', {
  id: id(),
  draft_id: integer('draft_id').notNull(),
  user_id: integer('user_id').notNull(),
  platform: text('platform').notNull().default(''),
  captured_on: text('captured_on').notNull(),
  views: integer('views'),
  likes: integer('likes'),
  comments: integer('comments'),
  shares: integer('shares'),
  follows: integer('follows'),
  note: text('note').notNull().default(''),
  created_at: text('created_at').notNull(),
  updated_at: text('updated_at').notNull(),
}, (t) => [
  uniqueIndex('idx_metrics_day').on(t.draft_id, t.platform, t.captured_on),
  index('idx_metrics_user').on(t.user_id, t.draft_id),
]);

export const jobs = pgTable('jobs', {
  id: id(),
  user_id: integer('user_id').notNull(),
  kind: text('kind').notNull(),
  ref: text('ref').notNull().default(''),
  label: text('label').notNull().default(''),
  payload_json: text('payload_json').notNull().default('{}'),
  status: text('status').notNull().default('queued'),
  result_json: text('result_json').notNull().default('null'),
  error: text('error').notNull().default(''),
  held: doublePrecision('held').notNull().default(0),
  hold_feature: text('hold_feature').notNull().default(''),
  attempts: integer('attempts').notNull().default(0),
  created_at: text('created_at').notNull(),
  started_at: text('started_at').notNull().default(''),
  finished_at: text('finished_at').notNull().default(''),
}, (t) => [
  index('idx_jobs_user').on(t.user_id, t.id),
  index('idx_jobs_status').on(t.status, t.id),
  // 迁移 2：同一件事（ref）同时只能有一条在排队或在跑
  uniqueIndex('idx_jobs_active_ref').on(t.user_id, t.ref)
    .where(sql`ref <> '' AND status IN ('queued', 'running')`),
]);

export const orders = pgTable('orders', {
  id: id(),
  out_trade_no: text('out_trade_no').notNull().unique(),
  user_id: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(),
  sku: text('sku').notNull(),
  amount: integer('amount').notNull(),
  channel: text('channel').notNull(),
  status: text('status').notNull().default('pending'),
  trade_no: text('trade_no').notNull().default(''),
  paid_at: text('paid_at').notNull().default(''),
  granted_at: text('granted_at').notNull().default(''),
  raw: text('raw').notNull().default(''),
  created_at: text('created_at').notNull(),
}, (t) => [index('idx_orders_user').on(t.user_id, t.id)]);

export const settings = pgTable('settings', {
  k: text('k').primaryKey(),
  v: text('v').notNull().default(''),
  secret: integer('secret').notNull().default(0),
  updated_at: text('updated_at').notNull(),
  updated_by: text('updated_by').notNull().default(''),
});

export const usageEvents = pgTable('usage_events', {
  id: id(),
  user_id: integer('user_id'),
  feature: text('feature').notNull(),
  provider: text('provider').notNull().default(''),
  model: text('model').notNull().default(''),
  variant: text('variant').notNull().default(''),
  ok: integer('ok').notNull().default(1),
  ms: integer('ms').notNull().default(0),
  input_tokens: integer('input_tokens').notNull().default(0),
  output_tokens: integer('output_tokens').notNull().default(0),
  units: doublePrecision('units').notNull().default(0),
  unit: text('unit').notNull().default(''),
  error: text('error').notNull().default(''),
  created_at: text('created_at').notNull(),
}, (t) => [
  index('idx_usage_time').on(t.created_at),
  index('idx_usage_user').on(t.user_id, t.created_at),
]);

export const promptVariants = pgTable('prompt_variants', {
  id: id(),
  feature: text('feature').notNull(),
  name: text('name').notNull(),
  system: text('system').notNull(),
  weight: integer('weight').notNull().default(1),
  active: integer('active').notNull().default(0),
  note: text('note').notNull().default(''),
  created_at: text('created_at').notNull(),
}, (t) => [index('idx_variants_feature').on(t.feature, t.active)]);

export const promptRevisions = pgTable('prompt_revisions', {
  id: id(),
  feature: text('feature').notNull(),
  system: text('system').notNull(),
  source: text('source').notNull(),
  note: text('note').notNull().default(''),
  active: integer('active').notNull().default(0),
  user_id: integer('user_id').notNull().default(0),
  created_at: text('created_at').notNull(),
}, (t) => [
  index('idx_prompt_rev').on(t.feature, t.id),
  // 迁移 3：同一条提示词同时只能启用一版
  uniqueIndex('idx_prompt_one_active').on(t.feature).where(sql`active = 1`),
]);

export const evalCases = pgTable('eval_cases', {
  id: id(),
  feature: text('feature').notNull(),
  title: text('title').notNull(),
  input_json: text('input_json').notNull().default('{}'),
  created_at: text('created_at').notNull(),
});

export const evalRuns = pgTable('eval_runs', {
  id: id(),
  batch: text('batch').notNull(),
  case_id: integer('case_id').notNull().references(() => evalCases.id, { onDelete: 'cascade' }),
  variant_id: integer('variant_id'),
  variant_name: text('variant_name').notNull().default('内置'),
  output: text('output').notNull().default(''),
  scores_json: text('scores_json').notNull().default('{}'),
  ms: integer('ms').notNull().default(0),
  error: text('error').notNull().default(''),
  created_at: text('created_at').notNull(),
}, (t) => [index('idx_runs_batch').on(t.batch, t.case_id)]);

export const evalVotes = pgTable('eval_votes', {
  id: id(),
  batch: text('batch').notNull(),
  case_id: integer('case_id').notNull(),
  left_id: integer('left_id').notNull(),
  right_id: integer('right_id').notNull(),
  winner: integer('winner').notNull().default(0),
  created_at: text('created_at').notNull(),
});

/* 迁移 4：App 离线收件箱的去重记录。同一个 key 只处理一次，ref_id 指向建出来的选题或素材 */
export const inboxKeys = pgTable('inbox_keys', {
  user_id: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  key: text('key').notNull(),
  kind: text('kind').notNull(),
  ref_id: integer('ref_id'),
  created_at: text('created_at').notNull(),
}, (t) => [primaryKey({ columns: [t.user_id, t.key] })]);

/* 迁移 4：对标速存。只留标题、提纲和开头摘要，用来学结构 */
export const benchmarks = pgTable('benchmarks', {
  id: id(),
  user_id: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  persona_id: integer('persona_id').notNull().references(() => personas.id, { onDelete: 'cascade' }),
  url: text('url').notNull().default(''),
  title: text('title').notNull().default(''),
  outline_json: text('outline_json').notNull().default('[]'),
  excerpt: text('excerpt').notNull().default(''),
  created_at: text('created_at').notNull(),
}, (t) => [index('idx_benchmarks_persona').on(t.user_id, t.persona_id, t.id)]);

/* 迁移 7：同步密钥。给 Obsidian 插件这类「只读、长期挂着」的客户端用：
 * 只存 sha256，不存明文；只能调 /api/export/*，不能当登录用 */
export const syncKeys = pgTable('sync_keys', {
  id: id(),
  user_id: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull().default(''),
  key_hash: text('key_hash').notNull(),
  prefix: text('prefix').notNull(),
  created_at: text('created_at').notNull(),
  last_used_at: text('last_used_at').notNull().default(''),
}, (t) => [uniqueIndex('idx_sync_keys_hash').on(t.key_hash), index('idx_sync_keys_user').on(t.user_id)]);

/* 迁移 8：个人档案。跟着用户走（所有账号共用）：工作经历、项目经历、观点。
 * visibility = background 时只作背景，写作时不写出机构名和能认出来的细节 */
export const profileEntries = pgTable('profile_entries', {
  id: id(),
  user_id: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull().default('work'),         // work | project | opinion | other
  title: text('title').notNull(),
  period: text('period').notNull().default(''),
  org: text('org').notNull().default(''),
  role: text('role').notNull().default(''),
  body: text('body').notNull().default(''),
  result: text('result').notNull().default(''),
  tags: text('tags').notNull().default(''),
  visibility: text('visibility').notNull().default('public'),
  source: text('source').notNull().default('manual'),   // manual | resume | article | voice | material（从素材库挪过来）
  used_count: integer('used_count').notNull().default(0),
  created_at: text('created_at').notNull(),
  updated_at: text('updated_at').notNull(),
}, (t) => [index('idx_profile_user').on(t.user_id, t.id)]);

/* 迁移 9：向量。kind = material | profile | sample，ref_id 指向对应表的行；hash 是向量化那段文字的指纹，
 * 内容没变就不重算。vec 是归一化过的 1024 维向量（real[]）。装了 pgvector 就在库里算距离 */
export const embeddings = pgTable('embeddings', {
  id: id(),
  user_id: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(),
  ref_id: integer('ref_id').notNull(),
  hash: text('hash').notNull(),
  vec: real('vec').array().notNull(),
  updated_at: text('updated_at').notNull(),
}, (t) => [uniqueIndex('idx_embed_ref').on(t.kind, t.ref_id), index('idx_embed_user').on(t.user_id, t.kind)]);

/* 迁移 8：改稿偏好。从「AI 初稿 → 作者定稿」的差别里学到的习惯，按账号存 */
export const stylePrefs = pgTable('style_prefs', {
  id: id(),
  user_id: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  persona_id: integer('persona_id').notNull().references(() => personas.id, { onDelete: 'cascade' }),
  rule: text('rule').notNull(),
  evidence: text('evidence').notNull().default(''),
  source_draft_id: integer('source_draft_id'),
  hits: integer('hits').notNull().default(1),
  status: text('status').notNull().default('on'),       // on | off
  created_at: text('created_at').notNull(),
  updated_at: text('updated_at').notNull(),
}, (t) => [index('idx_prefs_persona').on(t.user_id, t.persona_id, t.id)]);

/* 迁移 8：学习记录。每次学到了什么，「AI 眼中的我」里给作者看；kind = candidates 的是待确认的经历/观点 */
export const learnLog = pgTable('learn_log', {
  id: id(),
  user_id: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  persona_id: integer('persona_id').references(() => personas.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(),                         // digest | prefs | sample | candidates
  summary: text('summary').notNull(),
  detail_json: text('detail_json').notNull().default('null'),
  status: text('status').notNull().default(''),         // candidates：'' 待处理 / done
  created_at: text('created_at').notNull(),
}, (t) => [index('idx_learn_log').on(t.user_id, t.persona_id, t.id)]);


/* 迁移 10：邀请码。后台生成，一码只能注册一个人；used_at 非空 = 用过，revoked_at 非空 = 作废 */
export const invites = pgTable('invites', {
  id: id(),
  code: text('code').notNull().unique(),
  note: text('note').notNull().default(''),
  created_by: text('created_by').notNull().default(''),
  created_at: text('created_at').notNull(),
  used_by: integer('used_by').references(() => users.id, { onDelete: 'set null' }),
  used_name: text('used_name').notNull().default(''),
  used_at: text('used_at').notNull().default(''),
  revoked_at: text('revoked_at').notNull().default(''),
});
