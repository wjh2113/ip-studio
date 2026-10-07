/* 语义召回的测试主体：semantic.test.js（pgvector 在库里算）和 semantic-node.test.js（PGVECTOR=off，在 Node 里算）共用。
 * 起一个假网关：按几个「概念词」给固定方向的向量，这样能测出「字面不像、意思像」的召回。 */
import { createServer } from 'node:http';

const DIMS = 1024;
const CONCEPTS = [
  /管理|团队|带人|下属|领导|新人/,
  /做菜|备菜|厨房|菜谱|下饭/,
  /跑步|马拉松|配速/,
];
export const calls = [];
export let failNext = 0;
export const setFail = (n) => { failNext = n; };

function vectorOf(text) {
  const v = new Array(DIMS).fill(0);
  CONCEPTS.forEach((re, i) => { if (re.test(text)) v[i] = 1; });
  v[DIMS - 1] = 0.3;                 // 公共分量：完全不相干的也有一点相似度，和真模型一样
  return v;
}

export async function startFakeGateway() {
  const server = createServer(async (req, res) => {
    let raw = '';
    for await (const c of req) raw += c;
    const body = JSON.parse(raw || '{}');
    calls.push({ path: req.url, auth: req.headers.authorization, body });
    if (failNext > 0) { failNext -= 1; res.writeHead(503).end('{"error":"busy"}'); return; }
    const input = Array.isArray(body.input) ? body.input : [body.input];
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      object: 'list', model: 'BAAI/bge-m3',
      data: input.map((t, index) => ({ object: 'embedding', index, embedding: vectorOf(t) })),
      usage: { prompt_tokens: 5 * input.length, total_tokens: 5 * input.length },
      gateway: { capability: 'embedding', dimensions: DIMS },
    }));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  process.env.LLM_GATEWAY_URL = `http://127.0.0.1:${server.address().port}`;
  process.env.LLM_GATEWAY_API_KEY = 'test-key';
  process.env.EMBEDDING_PROVIDER = 'gateway';
  return server;
}

export function semanticSuite(test, assert, { expectPgvector }) {
  let mods;
  let user;
  let persona;
  const load = async () => {
    if (mods) return mods;
    const db = await import('../server/db.js');
    const { recallMaterials } = await import('../server/routes.js');
    const common = await import('../server/routes/common.js');
    const sem = await import('../server/semantic.js');
    user = await db.Users.create(`sem-${process.pid}`, 'x:y');
    persona = await db.Personas.create(user.id, {
      name: '语义号', platform: 'xiaohongshu', tone: '轻松', content_focus: '', audience: '', problem: '', notes: '',
      creator_age: '', creator_gender: '', creator_industry: '', creator_role: '', creator_traits: '',
    });
    mods = { db, recallMaterials, common, sem };
    return mods;
  };

  test(`距离在${expectPgvector ? ' pgvector ' : ' Node '}里算`, async () => {
    const { db } = await load();
    assert.equal(Boolean(await db.pgvectorSchema()), expectPgvector);
  });

  test('素材：字面不像、意思像的也能召回；不相干的不给；字面命中的照旧', async () => {
    const { db, recallMaterials, sem } = await load();
    await db.Materials.create(user.id, { kind: '文章', title: '带下属的三个教训', body: '第一年当组长，新人离职了两个', tags: '职场' });
    await db.Materials.create(user.id, { kind: '文章', title: '周末备菜', body: '30 分钟做三个下饭菜', tags: '做菜' });
    await db.Materials.create(user.id, { kind: '文章', title: 'AI 让团队变小', body: '8 人团队走了 4 个', tags: 'AI,团队' });
    await sem.settleIndexing();
    const got = (await recallMaterials(user.id, null, '怎么管理团队')).map((m) => m.title);
    assert.ok(got.includes('带下属的三个教训'), `语义召回没找回来：${got}`);
    assert.ok(got.includes('AI 让团队变小'));
    assert.ok(!got.includes('周末备菜'));
    // 字面分也参与排序：两条语义一样像，字面命中「团队」的排前面
    assert.equal(got[0], 'AI 让团队变小');
    assert.deepEqual(await recallMaterials(user.id, null, '区块链跨境支付'), []);
  });

  test('请求格式按网关约定：能力名、维度、密钥只在服务端', async () => {
    const req = calls.find((c) => c.path === '/api/ai/embeddings');
    assert.ok(req);
    assert.equal(req.auth, 'Bearer test-key');
    assert.equal(req.body.capability, 'embedding');
    assert.equal(req.body.dimensions, 1024);
    assert.equal(req.body.dataClass, 'internal');
    assert.ok(Array.isArray(req.body.input));
    assert.ok(!('model' in req.body), '不能在请求里写上游模型名');
  });

  test('内容没变不重算；改了才重算；删了向量跟着删', async () => {
    const { db, sem } = await load();
    const m = (await db.Materials.list(user.id)).find((x) => x.title === '周末备菜');
    const before = calls.length;
    assert.equal((await sem.indexUser(user.id)).material, 0);
    assert.equal(calls.length, before);
    await db.Materials.update(m.id, user.id, { kind: '文章', title: '周末备菜', body: '一小时备好一周的菜谱', tags: '做菜' });
    assert.equal((await sem.ensureVectors(user.id, 'material', await db.Materials.list(user.id))).done, 1);
    assert.equal((await db.Embeddings.stats(user.id)).material, 3);
    await db.Materials.remove(m.id, user.id);
    assert.equal((await db.Embeddings.stats(user.id)).material, 2);
  });

  test('个人档案和语气样本也走语义召回', async () => {
    const { db, common, sem } = await load();
    await db.Profile.create(user.id, { kind: 'work', title: '第一次当组长', body: '带 5 个新人做交付', tags: '' });
    await db.Profile.create(user.id, { kind: 'other', title: '跑完第一个全马', body: '配速 6 分', tags: '' });
    await sem.settleIndexing();
    assert.deepEqual((await common.recallProfile(user.id, '管理团队的心得')).map((e) => e.title), ['第一次当组长']);

    await db.Personas.setDigest?.(persona.id, user.id, '语气档案');
    const p = { ...persona, style_digest: '有' };
    await db.Samples.create(user.id, persona.id, { title: '我的下饭菜单', content: '厨房里最常做的几道菜'.repeat(10) });
    await db.Samples.create(user.id, persona.id, { title: '新人入职第一周', content: '带新人这件事我想了很久'.repeat(10) });
    await db.Samples.create(user.id, persona.id, { title: '随便写写', content: '今天天气不错'.repeat(10) });
    await sem.settleIndexing();
    const picked = (await common.styleSamples(p, user.id, '怎么带团队')).map((s) => s.title);
    assert.equal(picked[0], '新人入职第一周');
    assert.equal(picked.length, 2);           // 不够像的用最近的补齐
  });

  test('向量接口出错：这次只按字面召回，不报错', async () => {
    const { recallMaterials } = await load();
    setFail(5);
    const got = (await recallMaterials(user.id, null, '团队变小了怎么办')).map((m) => m.title);
    setFail(0);
    assert.deepEqual(got, ['AI 让团队变小']);
  });
}
