<template>
  <div v-if="!a.admin" id="gate" class="auth-screen" :class="{ hidden: !a.gate }">
    <!-- 登录 / 首次设置 -->
    <div class="auth-hero">
      <div class="auth-brand"><span class="brand-mark" aria-hidden="true"></span><span>自媒体助手</span></div>
      <p class="auth-sub">管理后台</p>
    </div>
    <div class="auth-card gate">
      <div class="gate-mark" aria-hidden="true"><Icon name="shield" :size="26" /></div>
      <p class="gate-sub" id="gateSub">{{ gateSub }}</p>
      <form id="gateForm" autocomplete="off" @submit.prevent="submit">
        <label v-if="!passwordOnly" id="adminUserRow">管理员用户名<span class="input-ic"><Icon name="user" /><input name="username" v-model="username" required maxlength="24" autocomplete="username" /></span></label>
        <label>密码<span class="input-ic"><Icon name="lock" /><input name="password" v-model="password" type="password" required
          :placeholder="passwordOnly ? '管理员密码' : a.gate?.needsSetup ? '至少 8 位' : ''"
          :autocomplete="a.gate?.needsSetup ? 'new-password' : 'current-password'" /></span></label>
        <p class="form-error" id="gateError">{{ gateError || a.gate?.error || '' }}</p>
        <BusyBtn type="submit" class="btn primary block lg" id="gateSubmit" :busy="busy" :disabled="Boolean(a.gate?.setupLocked)">{{ a.gate?.needsSetup ? '创建管理员' : '登录' }}</BusyBtn>
      </form>
      <p class="auth-tip"><a href="/"><Icon name="arrow-left" :size="13" />回到自媒体助手</a></p>
    </div>
  </div>

  <!-- 后台主体 -->
  <div v-else id="panel" class="app admin-app">
    <header class="topbar">
      <div class="brand"><span class="brand-mark" aria-hidden="true"></span><span>自媒体助手</span><em class="brand-sub">管理后台</em></div>
      <span class="chip llm-chip" id="llmChip" :class="{ warn: d && !d.llm.live }"><i class="dot" aria-hidden="true"></i>{{ d ? (d.llm.live ? `${d.llm.label} · ${d.llm.model}` : d.llm.label) : '…' }}</span>
      <div class="topbar-right">
        <span class="user-chip"><span class="user-avatar" aria-hidden="true"><Icon name="user" :size="15" /></span><span class="user-name" id="adminName">{{ a.admin.username }}</span></span>
        <a class="top-link" href="/"><Icon name="home" />前台</a>
        <button class="top-link" id="logoutBtn" @click="a.logout()"><Icon name="logout" />退出</button>
      </div>
    </header>

    <div class="admin-layout">
      <!-- 十个分区堆在一列里往下滚，找一个东西要滚半天：一次只显示一个 -->
      <nav class="admin-nav" id="adminNav">
        <button v-for="x in ADMIN_SECTIONS" :key="x.key" type="button" :data-sec="x.key" :class="{ on: a.section === x.key }"
          :title="x.hint" @click="a.show(x.key)"><Icon :name="SEC_ICON[x.key] || 'list'" :size="16" /><span>{{ x.label }}<i>{{ x.hint }}</i></span></button>
      </nav>
      <main class="main admin-main">
        <section data-sec="overview" class="overview" :hidden="a.section !== 'overview'">
          <div class="page-head">
            <div>
              <h1>使用概览</h1>
              <p>查看平台整体运行情况与关键指标</p>
            </div>
            <span class="grow"></span>
            <select id="days" v-model="a.days" @change="a.load()">
              <option value="1">近 1 天</option>
              <option value="7">近 7 天</option>
              <option value="30">近 30 天</option>
              <option value="90">近 90 天</option>
            </select>
            <button class="btn primary" id="refreshBtn" @click="a.load()"><Icon name="refresh" :size="15" />刷新</button>
          </div>
          <div class="stat-row" id="stats">
            <div v-if="a.error" class="ideas-state error">{{ a.error }}</div>
            <template v-else-if="!d || a.loading"><div v-for="i in 4" :key="i" class="idea-skeleton"></div></template>
            <template v-else><div v-for="([k, v, sub], i) in stats" :key="k" class="stat" :data-tone="i">
              <span class="stat-ic"><Icon :name="STAT_ICON[i]" :size="16" /></span><span>{{ k }}</span><b>{{ v }}</b><em>{{ sub }}</em></div></template>
          </div>
          <div v-if="d" class="card trend-card">
            <div class="card-head"><h2>调用量趋势</h2><span class="grow"></span><span class="hint">每天的模型调用次数，悬停看 tokens</span></div>
            <div class="spark" id="spark">
              <div v-for="x in d.byDay" :key="x.day" class="bar" :style="{ height: `${Math.max(4, (x.calls / sparkMax) * 100)}%` }"
                :title="`${x.day}：${x.calls} 次调用 / ${fmtTokens(x.tokens)} tokens`"><b>{{ x.calls }}</b><span>{{ x.day.slice(5) }}</span></div>
            </div>
          </div>
        </section>

        <AbSection v-if="d" :hidden="a.section !== 'ab'" />
        <EvalSection v-if="d" :hidden="a.section !== 'eval'" />

        <!-- 内容质量：作者改了初稿多少、检查建议改了多少，按成稿提示词变体分行 -->
        <section class="card" data-sec="quality" :hidden="a.section !== 'quality'">
          <h2>内容质量<span class="sub" id="qualityNote">{{ d?.quality?.note }}</span></h2>
          <div class="table-wrap"><table class="admin-table" id="qualityTable">
            <template v-if="d?.quality?.rows.length">
              <thead><tr>
                <th>成稿提示词变体</th><th class="num">篇数</th>
                <th class="num" title="初稿被改掉的比例，中位数">改动中位数</th>
                <th class="num" title="一个字没改就发的">原样</th>
                <th class="num" title="改掉三成以上的">大改</th>
                <th class="num">检查建议</th><th class="num">改了</th><th class="num">照着改</th><th class="num">采纳率</th>
              </tr></thead>
              <tbody>
                <tr v-for="r in d.quality.rows" :key="r.variant" :class="{ total: r.variant === '全部' }">
                  <td>{{ r.variant }}</td>
                  <td class="num">{{ fmt(r.drafts) }}</td>
                  <td class="num"><Pct :v="r.editMedian" /></td>
                  <td class="num"><Pct :v="r.untouched" /></td>
                  <td class="num"><Pct :v="r.heavy" /></td>
                  <td class="num">{{ fmt(r.issues) }}</td>
                  <td class="num">{{ fmt(r.changed) }}</td>
                  <td class="num">{{ fmt(r.applied) }}</td>
                  <td class="num"><Pct :v="r.adoptRate" /></td>
                </tr>
              </tbody>
            </template>
            <tbody v-else-if="d"><tr><td class="dim">这段时间还没有模型写的成稿。</td></tr></tbody>
          </table></div>
        </section>

        <!-- 成本：每行标出用的哪个单价、是不是精确匹配到型号——估算就说是估算，别让人把这个数字当账单 -->
        <section class="card" data-sec="cost" :hidden="a.section !== 'cost'">
          <h2>成本估算<span class="sub" id="costNote">{{ d?.cost ? `${d.cost.note}${d.cost.unpriced ? ` · ${d.cost.unpriced} 项未计价` : ''}` : '' }}</span></h2>
          <div class="table-wrap"><table v-if="d?.cost" class="admin-table" id="costTable">
            <thead><tr><th>功能</th><th>模型</th><th class="num">次数</th><th class="num">计费量</th><th>单价</th><th>免费额度</th><th class="num">估算</th></tr></thead>
            <tbody>
              <tr v-for="(r, i) in d.cost.rows" :key="i">
                <td>{{ r.feature }}</td>
                <td class="mono">{{ r.model }}<em v-if="!r.exact" title="没有这个型号的价，按同族估的">≈</em></td>
                <td class="num">{{ fmt(r.calls) }}</td>
                <td class="num">{{ r.units ? `${fmt(Math.round(r.units))} ${r.unit || ''}` : fmtTokens((r.input_tokens || 0) + (r.output_tokens || 0)) }}</td>
                <td>{{ r.price || '—' }}</td>
                <td>{{ r.free || '—' }}</td>
                <td class="num"><span v-if="r.yuan === null" class="dim">{{ r.demo ? '演示模式' : '未计价' }}</span><template v-else>¥{{ r.yuan.toFixed(2) }}</template></td>
              </tr>
              <tr class="total"><td colspan="6">合计（未扣免费额度）</td><td class="num">¥{{ d.cost.total.toFixed(2) }}</td></tr>
            </tbody>
          </table></div>
        </section>

        <PaySection v-if="d" :hidden="a.section !== 'pay'" />

        <section class="card" data-sec="users" :hidden="a.section !== 'users'">
          <h2>用户</h2>
          <div class="table-wrap"><table v-if="d" class="admin-table" id="usersTable">
            <thead><tr>
              <th>用户</th><th>注册</th><th class="num">账号</th><th class="num">栏目</th>
              <th class="num">创作</th><th class="num">已完成</th><th class="num">语气样本</th>
              <th class="num">调用</th><th class="num">Tokens</th><th>最近活动</th>
            </tr></thead>
            <tbody>
              <tr v-for="u in d.users" :key="u.username">
                <td>{{ u.username }}</td><td>{{ fmtTime(u.created_at) }}</td>
                <td class="num">{{ u.personas }}</td><td class="num">{{ u.sections }}</td>
                <td class="num">{{ u.drafts }}</td><td class="num">{{ u.done_drafts }}</td><td class="num">{{ u.samples }}</td>
                <td class="num">{{ fmt(u.calls) }}</td><td class="num">{{ fmtTokens(u.tokens) }}</td>
                <td>{{ fmtTime(u.last_call_at || u.last_draft_at) }}</td>
              </tr>
            </tbody>
          </table></div>
        </section>

        <section class="card" data-sec="usage" :hidden="a.section !== 'usage'">
          <h2>各功能用量</h2>
          <div class="table-wrap"><table v-if="d" class="admin-table" id="featuresTable">
            <template v-if="d.byFeature.length">
              <thead><tr><th>功能</th><th class="num">调用</th><th class="num">成功率</th><th class="num">入 tokens</th><th class="num">出 tokens</th><th class="num">平均耗时</th></tr></thead>
              <tbody>
                <tr v-for="f in d.byFeature" :key="f.feature">
                  <td>{{ f.feature }}</td><td class="num">{{ fmt(f.calls) }}</td>
                  <td class="num">{{ Math.round((f.ok_calls / f.calls) * 100) }}%</td>
                  <td class="num">{{ fmtTokens(f.input_tokens) }}</td><td class="num">{{ fmtTokens(f.output_tokens) }}</td>
                  <td class="num">{{ (f.avg_ms / 1000).toFixed(1) }}s</td>
                </tr>
              </tbody>
            </template>
            <tbody v-else><tr><td>这段时间还没有调用记录</td></tr></tbody>
          </table></div>
          <div class="admin-errors" id="errors">
            <div v-for="(e, i) in d?.errors || []" :key="i" class="err-row"><b>{{ e.feature }}</b><span>{{ fmtTime(e.created_at) }}</span><span>{{ e.error }}</span></div>
          </div>
        </section>

        <PromptList :hidden="a.section !== 'prompts'" />

        <section class="card" data-sec="admins" :hidden="a.section !== 'admins'">
          <h2>管理员账号</h2>
          <div class="table-wrap"><table class="admin-table" id="adminsTable">
            <thead><tr><th>管理员</th><th>创建时间</th><th>最近登录</th></tr></thead>
            <tbody><tr v-for="x in d?.admins || []" :key="x.username"><td>{{ x.username }}</td><td>{{ fmtTime(x.created_at) }}</td><td>{{ fmtTime(x.last_login) }}</td></tr></tbody>
          </table></div>
        </section>
      </main>
    </div>
  </div>

  <Toast />
  <AskDialog />
</template>

<script setup>
import { computed, h, ref } from 'vue';
import BusyBtn from '../components/common/BusyBtn.vue';
import Icon from '../components/common/Icon.vue';
import Toast from '../components/common/Toast.vue';
import AskDialog from '../components/common/AskDialog.vue';
import AbSection from './AbSection.vue';
import EvalSection from './EvalSection.vue';
import PaySection from './PaySection.vue';
import PromptList from './PromptList.vue';
import { ADMIN_SECTIONS, fmt, fmtTime, fmtTokens, useAdminStore } from './store.js';

const a = useAdminStore();
const SEC_ICON = {
  overview: 'chart', quality: 'shield', cost: 'money', ab: 'layers', eval: 'flask',
  pay: 'card', usage: 'bolt', prompts: 'doc', users: 'users', admins: 'key',
};
const STAT_ICON = ['users', 'file', 'bolt', 'layers', 'clock'];
const d = computed(() => a.overview);

/* 百分比；没有数据显示一道灰杠，别显示成 0% 让人误会 */
const Pct = (props) => (props.v == null ? h('span', { class: 'dim' }, '—') : `${Math.round(props.v * 100)}%`);
Pct.props = ['v'];

/* ---------- 登录门 ---------- */
const username = ref('');
const password = ref('');
const gateError = ref('');
const busy = ref(false);

// 配了 ADMIN_USERNAME 的单管理员模式：只问密码，用户名留空由服务端补
const passwordOnly = computed(() => Boolean(a.gate?.gate && !a.gate.needsSetup && !a.gate.setupLocked));
const gateSub = computed(() => {
  const g = a.gate;
  if (!g) return '这是独立于业务账号的管理入口。';
  if (g.setupLocked) return '管理员尚未初始化。公网入口已关闭，请在服务器用环境变量创建。';
  if (g.needsSetup) return '还没有管理员。第一次进来请设置一个——设置完这个入口就关闭了。';
  if (passwordOnly.value) return '输入管理员密码进入后台。';
  return '这是独立于业务账号的管理入口。';
});

async function submit() {
  gateError.value = '';
  busy.value = true;
  try {
    await a.login(passwordOnly.value ? '' : username.value, password.value);
  } catch (err) {
    gateError.value = err.message;
  } finally {
    busy.value = false;
  }
}

/* ---------- 概览 ---------- */
const stats = computed(() => {
  const x = d.value;
  if (!x) return [];
  const t = x.totals;
  const fail = t.calls - t.okCalls;
  return [
    ['用户数', fmt(x.users.length), `${x.users.filter((u) => u.drafts > 0).length} 人有创作`],
    ['创作总数', fmt(x.users.reduce((n, u) => n + u.drafts, 0)), `${fmt(x.users.reduce((n, u) => n + u.done_drafts, 0))} 篇已完成`],
    ['模型调用', fmt(t.calls), fail ? `${fail} 次失败` : '全部成功'],
    ['Token 合计', fmtTokens(t.inputTokens + t.outputTokens), `入 ${fmtTokens(t.inputTokens)} / 出 ${fmtTokens(t.outputTokens)}`],
    ['平均耗时', `${(t.avgMs / 1000).toFixed(1)}s`, `近 ${x.days} 天`],
  ];
});
const sparkMax = computed(() => Math.max(1, ...(d.value?.byDay || []).map((x) => x.calls)));

a.boot();
</script>
