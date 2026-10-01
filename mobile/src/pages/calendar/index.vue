<template>
  <view class="page cal">
    <!-- 内容日历（周视图）：连载型账号看节奏用。只读 + 轻改状态（标已发布），不做排期甘特图 -->
    <view class="wk-h">
      <view class="nav" @tap="shift(-7)"><Ic name="chev-left" :size="32" /></view>
      <view class="grow center"><view class="wk-t">{{ title }}</view><view class="faint s" @tap="goToday">{{ isThisWeek ? '本周' : '回到本周' }}</view></view>
      <view class="nav" @tap="shift(7)"><Ic name="chev-right" :size="32" /></view>
    </view>
    <view class="legend"><view v-for="k in STATE_KEYS" :key="k" class="lg"><view class="dot" :style="{ background: STATES[k].color }"></view>{{ STATES[k].label }}</view></view>

    <view v-if="loading && !days.length" class="wrap"><view v-for="i in 4" :key="i" class="skel" style="height: 120rpx; margin-bottom: 16rpx"></view></view>
    <view v-for="(d, i) in days" :key="d.day" :id="`d${d.day}`" class="day" :class="{ today: d.day === today, focus: d.day === focus }">
      <view class="day-h"><text class="dw">{{ d.day === today ? '今天' : WEEKDAYS[i] }}</text><text class="dd">{{ d.day.slice(5).replace('-', '.') }}</text><view class="grow"></view><text class="faint s">{{ d.items.length ? `${d.items.length} 篇` : '' }}</text></view>
      <view v-for="x in d.items" :key="x.id" class="it" @tap="open(x)">
        <view class="dots"><view v-for="s in x.states" :key="s" class="dot" :style="{ background: STATES[s]?.color }"></view></view>
        <view class="grow">
          <view class="ellipsis it-t">{{ x.title || '未命名' }}</view>
          <view class="faint s">{{ x.states.map((s) => STATES[s]?.label).join(' · ') }}</view>
        </view>
        <text class="cta">{{ primaryAction(x.states).label }}</text>
      </view>
      <view v-if="!d.items.length" class="none">—</view>
    </view>
    <view class="hint wrap foot">灵感型、不按周更的账号可以不看这页。</view>
  </view>
</template>

<script setup>
import { computed, ref } from 'vue';
import { onLoad, onShow } from '@dcloudio/uni-app';
import Ic from '../../components/Ic.vue';
import { api } from '../../lib/api.js';
import { go, sheet, toast } from '../../lib/ui.js';
import { addDays, localDay, mondayOf, WEEKDAYS } from '../../lib/text.js';
import { primaryAction, STATES, STATE_KEYS } from '../../lib/states.js';
import { useAccountStore } from '../../stores/account.js';

const acc = useAccountStore();
const today = localDay();
const start = ref(mondayOf());
const focus = ref('');
const days = ref([]);
const loading = ref(false);

const title = computed(() => `${start.value.slice(5).replace('-', '.')} – ${addDays(start.value, 6).slice(5).replace('-', '.')}`);
const isThisWeek = computed(() => start.value === mondayOf());

async function load() {
  loading.value = true;
  const q = `from=${start.value}&to=${addDays(start.value, 6)}${acc.currentId ? `&persona=${acc.currentId}` : ''}`;
  try { days.value = (await api(`/calendar?${q}`)).days || []; } catch (err) { toast(err.message); } finally { loading.value = false; }
}

onLoad((q) => { if (q.day) { focus.value = q.day; start.value = mondayOf(q.day); } });
onShow(load);

function shift(n) { start.value = addDays(start.value, n); load(); }
function goToday() { if (!isThisWeek.value) { start.value = mondayOf(); load(); } }

async function open(x) {
  const main = primaryAction(x.states);
  const published = x.states.includes('published');
  const opts = [main.label, '阅读', published ? '取消已发布' : '标为已发布'];
  const i = await sheet(opts);
  if (i === 0) go(main.page, { id: x.id });
  else if (i === 1) go('create/draft', { id: x.id });
  else if (i === 2) {
    try {
      await api(`/drafts/${x.id}/published`, { method: 'PUT', body: { date: published ? '' : today } });
      toast(published ? '已取消' : '已标为发布', 'success');
      load();
    } catch (err) { toast(err.message); }
  }
}
</script>

<style lang="scss" scoped>
.cal { padding-top: 12rpx; }
.wk-h { display: flex; align-items: center; padding: 0 28rpx 12rpx; }
.nav { width: 72rpx; height: 72rpx; border-radius: 50%; background: var(--panel); display: flex; align-items: center; justify-content: center; }
.center { text-align: center; }
.wk-t { font-size: 34rpx; font-weight: 700; }
.s { font-size: 22rpx; }
.legend { display: flex; justify-content: space-around; padding: 0 28rpx 20rpx; font-size: 22rpx; color: var(--muted); }
.lg { display: flex; align-items: center; gap: 8rpx; }
.dot { width: 14rpx; height: 14rpx; border-radius: 50%; }
.day { margin: 0 28rpx 14rpx; padding: 20rpx 24rpx; border-radius: 20rpx; background: var(--panel); }
.day.today { box-shadow: inset 0 0 0 3rpx var(--accent); }
.day.focus { background: #f7faff; }
.day-h { display: flex; align-items: baseline; gap: 12rpx; }
.dw { font-size: 28rpx; font-weight: 700; }
.dd { font-size: 24rpx; color: var(--muted); }
.it { display: flex; align-items: center; gap: 16rpx; padding: 16rpx 0 6rpx; }
.dots { display: flex; flex-direction: column; gap: 6rpx; }
.it .grow { min-width: 0; }
.it-t { font-size: 28rpx; }
.cta { font-size: 24rpx; color: var(--accent-ink); }
.none { font-size: 24rpx; color: var(--faint); padding-top: 6rpx; }
.foot { padding: 20rpx 28rpx 40rpx; }
</style>
