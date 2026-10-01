<template>
  <view class="page">
    <TopBar />
    <!-- 今天：清醒的日程板，不是信息流。从上到下是「现在该做什么」→「今天能发什么」→「这周的节奏」 -->

    <view v-if="loading && !d" class="wrap">
      <view v-for="i in 3" :key="i" class="skel" style="height: 220rpx; margin-bottom: 24rpx"></view>
    </view>

    <template v-else-if="d">
      <!-- 待办条：三块可直达 -->
      <view class="card todo">
        <view class="card-h"><text class="card-t">待办</text><view class="grow"></view><text class="more" @tap="go('jobs/index')">任务中心<Ic name="chev-right" :size="24" color="#667085" /></text></view>
        <view class="todo-grid">
          <view class="todo-i blue" @tap="openMetrics">
            <view class="todo-h"><Ic name="chart" :size="28" color="#2f6bff" /><text>待填数据</text></view>
            <view class="todo-n">{{ d.metricsDue.length }}</view>
            <view class="todo-s">{{ metricsLine }}</view>
          </view>
          <view class="todo-i green" @tap="go('jobs/index')">
            <view class="todo-h"><Ic name="mic" :size="28" color="#16a34a" /><text>口播/出图中</text></view>
            <view class="todo-n">{{ d.jobs.active }}</view>
            <view class="todo-s">进行中</view>
          </view>
          <view class="todo-i violet" @tap="tab('inspire')">
            <view class="todo-h"><Ic name="bulb" :size="28" color="#7c5cff" /><text>选题池</text></view>
            <view class="todo-n">{{ d.poolUnused }}</view>
            <view class="todo-s">条未用</view>
          </view>
        </view>
      </view>

      <!-- 今日可发 -->
      <view class="card">
        <view class="card-h"><text class="card-t">今日可发</text><text class="card-sub">已成稿 · 待发布</text><view class="grow"></view><text class="more" @tap="go('calendar/index')">全部 {{ d.ready.length }}<Ic name="chev-right" :size="24" color="#667085" /></text></view>
        <scroll-view v-if="d.ready.length" scroll-x class="ready" :show-scrollbar="false">
          <view v-for="x in d.ready" :key="x.id" class="ready-i">
            <view class="ready-t" @tap="go('create/draft', { id: x.id })">{{ x.title || '未命名' }}</view>
            <view class="ready-s"><text class="chip gray">{{ session.platformLabel(x.platform) }}</text><text class="faint">成稿于 {{ ago(x.updatedAt) }}</text></view>
            <view class="ready-a">
              <button class="btn small soft" @tap="go('create/draft', { id: x.id })">看全文</button>
              <button class="btn small" @tap="go('create/package', { id: x.id })">发布包</button>
            </view>
          </view>
        </scroll-view>
        <view v-else class="hint">还没有待发布的成稿。去「创作」写一篇，写完会出现在这里。</view>
      </view>

      <!-- 口播未练 + 额度 -->
      <view class="pair">
        <view class="card half warm" @tap="tab('speak')">
          <view class="card-h"><Ic name="mic" :size="30" color="#e5484d" /><text class="card-t sm">口播未练</text><view class="grow"></view><text class="big-n red">{{ d.speakTodo.length }}</text><text class="faint unit">篇</text></view>
          <view v-for="x in d.speakTodo.slice(0, 2)" :key="x.id" class="mini-row ellipsis" @tap.stop="go('speak/record', { id: x.id })">《{{ x.title || '未命名' }}》</view>
          <view v-if="!d.speakTodo.length" class="hint">没有欠着的口播</view>
        </view>
        <view class="card half" @tap="go('me/plan')">
          <view class="card-h"><text class="card-t sm">额度</text><view class="grow"></view><text class="faint unit">剩余</text><text class="big-n blue">{{ d.quota.left.toLocaleString() }}</text></view>
          <view class="bar"><view class="bar-in" :class="{ low: d.quota.low }" :style="{ width: `${pct}%` }"></view></view>
          <view class="hint">{{ d.quota.label }} · 共 {{ d.quota.total.toLocaleString() }} 点</view>
          <view v-if="d.quota.low" class="warn-line"><Ic name="info" :size="24" color="#c76a00" />额度快用完了</view>
        </view>
      </view>

      <!-- 失败任务 -->
      <view v-if="d.jobs.failed.length" class="card">
        <view class="card-h"><text class="card-t">失败任务</text><view class="grow"></view><text class="more blue" @tap="retryAll"><Ic name="refresh" :size="26" color="#2f6bff" />一键重试</text></view>
        <view v-for="j in d.jobs.failed" :key="j.id" class="fail-i">
          <view class="grow">
            <view class="ellipsis">{{ j.label || j.kind }}</view>
            <view class="fail-s">{{ j.error || '失败' }} · {{ ago(j.finishedAt) }}</view>
          </view>
          <button class="btn small primary" @tap="retry(j.id)">重试</button>
        </view>
      </view>

      <!-- 审稿时划到「稍后」的建议 -->
      <view v-if="later.length" class="card">
        <view class="card-h"><text class="card-t">稍后处理</text><text class="card-sub">审稿时留下的</text><view class="grow"></view><text class="faint">{{ later.length }}</text></view>
        <view v-for="x in later.slice(0, 3)" :key="x.draftId + x.quote" class="fail-i" @tap="go('create/review', { id: x.draftId })">
          <view class="grow"><view class="ellipsis">「{{ x.quote }}」</view><view class="faint s">《{{ x.title || '未命名' }}》</view></view>
          <Ic name="chev-right" :size="26" color="#98a2b3" />
        </view>
      </view>

      <!-- 本周日历缩略 -->
      <view class="card">
        <view class="card-h"><text class="card-t">本周日历</text><text class="card-sub">连载视角</text><view class="grow"></view><text class="more" @tap="go('calendar/index')">内容日历<Ic name="chev-right" :size="24" color="#667085" /></text></view>
        <view class="week">
          <view v-for="(w, i) in d.week" :key="w.day" class="wk" :class="{ today: w.day === today }" @tap="go('calendar/index', { day: w.day })">
            <text class="wk-d">{{ w.day === today ? '今天' : WEEKDAYS[i] }}</text>
            <text class="wk-n">{{ w.day.slice(5).replace('-', '.') }}</text>
            <view class="wk-dots"><view v-for="s in dots(w)" :key="s" class="dot" :style="{ background: STATES[s].color }"></view></view>
            <text class="wk-c">{{ w.items.length || '' }}</text>
          </view>
        </view>
        <view class="legend"><view v-for="k in STATE_KEYS" :key="k" class="lg"><view class="dot" :style="{ background: STATES[k].color }"></view>{{ STATES[k].label }}</view></view>
      </view>

      <!-- 新号引导 -->
      <view v-if="!acc.list.length" class="card welcome">
        <view class="card-t">欢迎使用「自媒体助手」</view>
        <view class="hint">先给号定个位，以后每篇都会带上这份语境。也可以先记一条灵感。</view>
        <view class="row gap">
          <button class="btn primary" @tap="go('account/quick')">快速建号</button>
          <button class="btn" @tap="go('inspire/edit', { input: 'text' })">记一条灵感</button>
        </view>
      </view>
    </template>

    <view v-else class="empty">
      <Ic name="cloud-off" :size="96" color="#98a2b3" />
      <view>{{ error || '没加载出来' }}</view>
      <button class="btn small" style="margin-top: 20rpx" @tap="load">重试</button>
    </view>
    <view style="height: 40rpx"></view>
  </view>
</template>

<script setup>
import { computed, ref } from 'vue';
import { onPullDownRefresh, onShow, onUnload } from '@dcloudio/uni-app';
import TopBar from '../../components/TopBar.vue';
import Ic from '../../components/Ic.vue';
import { api } from '../../lib/api.js';
import { go, tab, toast } from '../../lib/ui.js';
import { ago, localDay, WEEKDAYS } from '../../lib/text.js';
import { STATES, STATE_KEYS } from '../../lib/states.js';
import { laterList } from '../../lib/later.js';
import { useSessionStore } from '../../stores/session.js';
import { useAccountStore } from '../../stores/account.js';
import { useJobsStore } from '../../stores/jobs.js';

const session = useSessionStore();
const acc = useAccountStore();
const jobs = useJobsStore();
const d = ref(null);
const loading = ref(false);
const error = ref('');
const today = localDay();
const later = ref([]);

const pct = computed(() => (d.value?.quota?.total ? Math.max(0, Math.min(100, (d.value.quota.left / d.value.quota.total) * 100)) : 0));
const metricsLine = computed(() => {
  const list = d.value?.metricsDue || [];
  const d1 = list.filter((x) => x.day === 1).length;
  const d7 = list.filter((x) => x.day === 7).length;
  return list.length ? `第1天 ${d1} · 第7天 ${d7}` : '没有要填的';
});

/* 一天最多画 4 个点：每种状态一个 */
const dots = (w) => STATE_KEYS.filter((k) => w.items.some((x) => x.states.includes(k)));

async function load() {
  if (!session.user) return;
  loading.value = true;
  error.value = '';
  later.value = laterList();
  try {
    const p = acc.currentId ? `?persona=${acc.currentId}` : '';
    d.value = await api(`/today${p}`);
  } catch (err) {
    error.value = err.message;
  } finally {
    loading.value = false;
    uni.stopPullDownRefresh();
  }
}

function openMetrics() {
  const first = d.value?.metricsDue?.[0];
  if (first) go('metrics/fill', { id: first.draftId, day: first.day });
  else toast('没有待填的发布数据');
}

async function retry(id) {
  try { await jobs.retry(id); toast('已重新排队'); load(); } catch (err) { toast(err.message); }
}
async function retryAll() {
  for (const j of d.value?.jobs?.failed || []) {
    try { await jobs.retry(j.id); } catch { /* 一个失败不挡后面的 */ }
  }
  toast('已重新排队');
  load();
}

const onPersona = () => load();
uni.$on('persona-changed', onPersona);
onUnload(() => uni.$off('persona-changed', onPersona));
onShow(load);
onPullDownRefresh(load);
</script>

<style lang="scss" scoped>
.page { min-height: 100vh; }
.todo-grid { display: flex; gap: 16rpx; }
.todo-i { flex: 1; border-radius: 20rpx; padding: 20rpx; }
.todo-i.blue { background: #eef3ff; }
.todo-i.green { background: #e9f8ef; }
.todo-i.violet { background: #f1edff; }
.todo-h { display: flex; align-items: center; gap: 8rpx; font-size: 22rpx; color: var(--muted); }
.todo-n { font-size: 52rpx; font-weight: 700; margin: 8rpx 0 2rpx; }
.todo-s { font-size: 22rpx; color: var(--muted); }
.ready { white-space: nowrap; }
.ready-i { display: inline-block; vertical-align: top; width: 300rpx; margin-right: 20rpx; padding: 20rpx; border-radius: 20rpx; background: var(--panel-2); white-space: normal; }
.ready-t { font-size: 28rpx; font-weight: 600; line-height: 1.45; height: 82rpx; overflow: hidden; }
.ready-s { display: flex; align-items: center; gap: 10rpx; font-size: 22rpx; margin: 12rpx 0 16rpx; }
.ready-a { display: flex; gap: 12rpx; }
.ready-a .btn { flex: 1; padding: 0; }
.pair { display: flex; gap: 20rpx; margin: 0 28rpx 24rpx; }
.card.half { flex: 1; margin: 0; min-width: 0; }
.card.warm { background: #fff7f6; }
.card-t.sm { font-size: 28rpx; margin-left: 8rpx; }
.big-n { font-size: 40rpx; font-weight: 700; }
.big-n.red { color: var(--danger); }
.big-n.blue { color: var(--accent-ink); }
.unit { font-size: 22rpx; margin: 0 6rpx; }
.mini-row { font-size: 24rpx; padding: 10rpx 0; border-top: 2rpx solid #f6e2e0; }
.bar { height: 12rpx; border-radius: 6rpx; background: var(--panel-2); overflow: hidden; margin: 8rpx 0 12rpx; }
.bar-in { height: 100%; background: var(--accent); border-radius: 6rpx; }
.bar-in.low { background: var(--danger); }
.warn-line { display: flex; align-items: center; gap: 8rpx; font-size: 22rpx; color: var(--warn); background: var(--warn-soft); padding: 8rpx 12rpx; border-radius: 10rpx; margin-top: 12rpx; }
.more.blue { color: var(--accent-ink); gap: 6rpx; }
.fail-i { display: flex; align-items: center; gap: 20rpx; padding: 16rpx 0; border-top: 2rpx solid var(--border); font-size: 28rpx; }
.fail-s { font-size: 22rpx; color: var(--danger); }
.s { font-size: 22rpx; }
.week { display: flex; gap: 8rpx; }
.wk { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 4rpx; padding: 14rpx 0; border-radius: 16rpx; }
.wk.today { background: var(--accent-soft); box-shadow: inset 0 0 0 2rpx var(--accent); }
.wk-d { font-size: 22rpx; color: var(--muted); }
.wk-n { font-size: 24rpx; font-weight: 600; }
.wk-dots { display: flex; gap: 4rpx; height: 14rpx; }
.dot { width: 12rpx; height: 12rpx; border-radius: 50%; }
.wk-c { font-size: 22rpx; color: var(--muted); height: 30rpx; }
.legend { display: flex; justify-content: space-around; margin-top: 16rpx; font-size: 22rpx; color: var(--muted); }
.lg { display: flex; align-items: center; gap: 8rpx; }
.welcome .row.gap { gap: 20rpx; margin-top: 24rpx; }
.welcome .btn { flex: 1; }
</style>
