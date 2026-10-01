<template>
  <section class="card" data-sec="eval">
    <!-- 打分两层：确定性指标（客观、可复现、不花钱）+ 盲测人工对比。不用大模型当裁判——让它评自己的输出，得到的是和气不是信号 -->
    <h2>Eval<span class="sub">固定用例 × 各个变体跑一遍，比确定性指标，再盲测挑一个</span></h2>
    <div class="ab-bar">
      <select id="evFeature" v-model="feature" @change="load">
        <option v-for="f in features" :key="f.key" :value="f.key">{{ f.label }}</option>
      </select>
      <button class="btn ghost small" id="evCaseAdd" @click="addCase">＋ 用例</button>
      <BusyBtn class="btn primary small" id="evRun" :busy="running" @click="run">跑一批</BusyBtn>
      <span class="grow"></span>
      <select id="evBatch" v-model="batch" @change="batch && show(batch)">
        <option value="">选一批结果…</option>
        <option v-for="b in batches" :key="b.batch" :value="b.batch">{{ b.batch }} · {{ b.cases }}用例×{{ b.variants }}变体</option>
      </select>
    </div>
    <div id="evCases">
      <p v-if="casesError" class="hint">{{ casesError }}</p>
      <p v-else-if="!cases.length" class="hint">还没有用例。用例是固定的输入，用来横向比不同变体——没有它，A/B 只能靠线上数据慢慢等。</p>
      <div v-for="c in cases" :key="c.id" class="ev-case">
        <b>{{ c.title }}</b>
        <span class="subj">{{ input(c).subject || '' }}{{ input(c).platform ? ` · ${input(c).platform}` : '' }}</span>
        <button class="mini" :data-evdel="c.id" @click="removeCase(c)">删</button>
      </div>
    </div>
    <div id="evResult">
      <div v-if="resultLoading" class="idea-skeleton"></div>
      <p v-else-if="resultError" class="hint">{{ resultError }}</p>
      <template v-else-if="result">
        <h3 style="margin:18px 0 8px;font-size:14px">确定性指标<em style="font-weight:400;font-size:12px;color:var(--muted);margin-left:9px">客观、可复现、不花钱。中位数不是平均数。</em></h3>
        <table class="admin-table">
          <thead><tr><th>变体</th><th class="num">跑了</th><th class="num">失败</th>
            <th class="num">标签唯一</th><th class="num">有对照</th><th class="num">空字段</th>
            <th class="num">字数</th><th class="num">偏离目标</th><th class="num">格式痕迹</th><th class="num">耗时</th>
            <th class="num">盲测胜出</th></tr></thead>
          <tbody>
            <tr v-for="x in result.summary" :key="x.name">
              <td>{{ x.name }}</td><td class="num">{{ x.runs }}</td><td class="num">{{ x.failed || '—' }}</td>
              <td class="num">{{ x.labelsUnique }}/{{ x.runs }}</td><td class="num">{{ x.contrastive ?? '—' }}</td>
              <td class="num">{{ x.emptyFields ?? '—' }}</td><td class="num">{{ x.chars ?? '—' }}</td>
              <td class="num">{{ x.lengthOff == null ? '—' : `${x.lengthOff > 0 ? '+' : ''}${x.lengthOff}%` }}</td>
              <td class="num">{{ x.traceCount ?? '—' }}</td><td class="num">{{ (x.ms / 1000).toFixed(1) }}s</td>
              <td class="num">{{ tally.get(x.name) || 0 }}</td>
            </tr>
          </tbody>
        </table>
        <h3 style="margin:22px 0 8px;font-size:14px">盲测<em style="font-weight:400;font-size:12px;color:var(--muted);margin-left:9px">隐去变体名，只看输出选一个。已投 {{ result.votes.total }} 次（{{ result.votes.ties }} 次平局）</em></h3>
        <template v-for="c in pairs" :key="c.id">
          <p v-if="!c.pair" class="hint">「{{ c.title }}」可比的输出不足两份。</p>
          <div v-else class="ev-block" :data-case="c.id">
            <b style="font-size:13px">{{ c.title }}</b>
            <div class="ev-pair">
              <div class="ev-side"><pre>{{ c.pair[0].output.slice(0, 2600) }}</pre></div>
              <div class="ev-side"><pre>{{ c.pair[1].output.slice(0, 2600) }}</pre></div>
            </div>
            <div class="ev-vote">
              <button class="btn ghost small" :disabled="voted.has(c.id)" @click="vote(c, c.pair[0].id)">左边更好</button>
              <button class="btn ghost small" :disabled="voted.has(c.id)" @click="vote(c, c.pair[1].id)">右边更好</button>
              <button class="btn ghost small" :disabled="voted.has(c.id)" @click="vote(c, 0)">差不多</button>
              <span class="grow"></span>
              <span v-if="voted.has(c.id)" class="ev-voted">已记下</span>
            </div>
          </div>
        </template>
      </template>
    </div>
  </section>
</template>

<script setup>
import { computed, reactive, ref, watch } from 'vue';
import BusyBtn from '../components/common/BusyBtn.vue';
import { ask, toast } from '../lib/feedback.js';
import { adminApi } from './store.js';
import { useAdminFeatures } from './features.js';

const { features, feature } = useAdminFeatures();
const cases = ref([]);
const casesError = ref('');
const batches = ref([]);
const batch = ref('');
const result = ref(null);
const resultLoading = ref(false);
const resultError = ref('');
const running = ref(false);
const voted = reactive(new Set());

// 功能列表由 A/B 那块拉来；拿到后默认选第一个
watch(features, (list) => { if (!feature.value && list.length) { feature.value = list[0].key; load(); } }, { immediate: true });

const input = (c) => { try { return JSON.parse(c.input_json); } catch { return {}; } };

async function load() {
  if (!feature.value) return;
  try {
    cases.value = (await adminApi(`/admin/eval/cases?feature=${feature.value}`)).cases;
    batches.value = (await adminApi('/admin/eval/batches')).batches;
    casesError.value = '';
  } catch (err) { casesError.value = err.message; }
}

async function addCase() {
  // 一个浮层收完所有字段，比连着弹两次 prompt 好——中途取消也不会留下半条
  const v = await ask.form({
    title: '新增 eval 用例',
    body: '用例是固定的输入，用来横向比不同变体。',
    ok: '添加',
    fields: [
      { key: 'title', label: '用例名称', placeholder: '例：AI与组织', required: true },
      { key: 'subject', label: '题材（这一步的输入）', placeholder: '例：AI 用进团队之后，人真的变少了吗', required: true, multiline: true, rows: 2 },
      { key: 'platform', label: '平台', value: 'gongzhonghao' },
      { key: 'tone', label: '风格调性', value: '实用干货' },
    ],
  });
  if (!v) return;
  try {
    await adminApi('/admin/eval/cases', {
      method: 'POST',
      body: { feature: feature.value, title: v.title, input: { subject: v.subject, platform: v.platform || 'gongzhonghao', tone: v.tone || '实用干货' } },
    });
    await load();
  } catch (err) { toast(err.message); }
}

async function removeCase(c) {
  if (!await ask.confirm({ title: c.title ? `删掉用例「${c.title}」？` : '删掉这个用例？', body: '已经跑过的结果不受影响。', ok: '删除', danger: true })) return;
  try { await adminApi(`/admin/eval/cases/${c.id}`, { method: 'DELETE' }); await load(); } catch (err) { toast(err.message); }
}

async function run() {
  if (!await ask.confirm({ title: '跑一批 eval？', body: '每个用例 × 每个变体各跑一次，会真的调模型、真的花钱。', ok: '开跑' })) return;
  running.value = true;
  try {
    const r = await adminApi('/admin/eval/run', { method: 'POST', body: { feature: feature.value } });
    toast(`跑完了：${r.done} 次成功${r.failed ? `，${r.failed} 次失败` : ''}`);
    await load();
    batch.value = r.batch;
    await show(r.batch);
  } catch (err) { toast(err.message); } finally { running.value = false; }
}

async function show(b) {
  voted.clear();
  resultLoading.value = true;
  resultError.value = '';
  try { result.value = await adminApi(`/admin/eval/${b}`); } catch (err) { resultError.value = err.message; } finally { resultLoading.value = false; }
}

const tally = computed(() => new Map(result.value?.votes?.tally || []));

/* 盲测：随机左右，隐去变体名——知道哪边是新的，判断就已经偏了。换一批结果时才重新洗 */
const pairs = computed(() => (result.value?.cases || []).map((c) => {
  const ok = c.runs.filter((r) => !r.error);
  if (ok.length < 2) return { ...c, pair: null };
  return { ...c, pair: Math.random() < 0.5 ? [ok[0], ok[1]] : [ok[1], ok[0]] };
}));

async function vote(c, winner) {
  try {
    await adminApi(`/admin/eval/${batch.value}/vote`, { method: 'POST', body: { case_id: c.id, left: c.pair[0].id, right: c.pair[1].id, winner } });
    voted.add(c.id);
  } catch (err) { toast(err.message); }
}
</script>
