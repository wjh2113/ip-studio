<template>
  <view class="page jb">
    <!-- 任务：出图、口播转写与评测都在后台做，关掉 App 也会接着跑 -->
    <view class="seg wrap-seg">
      <view v-for="g in GROUPS" :key="g.key" class="seg-i" :class="{ on: group === g.key }" @tap="group = g.key">{{ g.label }}<text class="n">{{ count(g.key) }}</text></view>
    </view>
    <view v-for="j in list" :key="j.id" class="job">
      <view class="j-top">
        <text class="chip" :class="KIND[j.kind]?.cls || 'gray'">{{ KIND[j.kind]?.label || j.kind }}</text>
        <text class="j-st" :class="j.status">{{ STATUS[j.status] || j.status }}</text>
        <view class="grow"></view>
        <text class="faint s">{{ ago(j.finishedAt || j.createdAt) }}</text>
      </view>
      <view class="j-t">{{ j.label || '任务' }}</view>
      <view v-if="j.status === 'running' || j.status === 'queued'" class="prog"><view class="prog-in" :class="j.status"></view></view>
      <view v-if="j.status === 'failed'" class="j-err">{{ j.error || '失败' }}</view>
      <view class="j-acts">
        <button v-if="j.status === 'queued'" class="btn small" @tap="cancel(j)">取消</button>
        <button v-if="j.status === 'failed'" class="btn small primary" @tap="retry(j)">重试</button>
        <button v-if="j.status === 'done'" class="btn small soft" @tap="openResult(j)">{{ j.kind === 'image' ? '看图 / 存相册' : '查看结果' }}</button>
      </view>
    </view>
    <view v-if="!list.length" class="empty">
      <Ic name="clipboard" :size="96" color="#98a2b3" />
      <view>{{ group === 'active' ? '没有在跑的任务。出图和口播评测会在后台做，关掉 App 也会接着跑。' : '这里还是空的。' }}</view>
    </view>
  </view>
</template>

<script setup>
import { computed, ref } from 'vue';
import { onPullDownRefresh, onShow } from '@dcloudio/uni-app';
import Ic from '../../components/Ic.vue';
import { go, toast } from '../../lib/ui.js';
import { ago } from '../../lib/text.js';
import { useJobsStore } from '../../stores/jobs.js';

const GROUPS = [{ key: 'active', label: '进行中' }, { key: 'done', label: '已完成' }, { key: 'failed', label: '失败' }];
const KIND = {
  image: { label: '出图', cls: 'teal' },
  speak: { label: '口播总评', cls: '' },
  pronounce: { label: '发音评测', cls: 'violet' },
  appearance: { label: '出镜评测', cls: 'violet' },
};
const STATUS = { queued: '排队中', running: '进行中', done: '已完成', failed: '失败', cancelled: '已取消' };

const jobs = useJobsStore();
const group = ref('active');

const pick = (k) => (k === 'active' ? jobs.active : k === 'done' ? jobs.done : jobs.failed);
const list = computed(() => pick(group.value));
const count = (k) => pick(k).length || '';

async function cancel(j) { try { await jobs.cancel(j.id); toast('已取消'); } catch (err) { toast(err.message); } }
async function retry(j) { try { await jobs.retry(j.id); toast('已重新排队'); } catch (err) { toast(err.message); } }

function openResult(j) {
  const p = j.payload || {};
  if (j.kind === 'image' && p.draftId) go('create/illus', { id: p.draftId });
  else if (p.speakId) go('speak/result', { id: p.speakId });
  else toast('这个任务没有可看的结果');
}

onShow(() => jobs.load());
onPullDownRefresh(async () => { await jobs.load(); uni.stopPullDownRefresh(); });
</script>

<style lang="scss" scoped>
.jb { padding-top: 20rpx; }
.wrap-seg { margin: 0 28rpx 20rpx; background: var(--panel); }
.n { font-size: 22rpx; margin-left: 6rpx; opacity: .7; }
.job { margin: 0 28rpx 16rpx; padding: 24rpx; border-radius: 20rpx; background: var(--panel); }
.j-top { display: flex; align-items: center; gap: 12rpx; }
.j-st { font-size: 24rpx; color: var(--muted); }
.j-st.running { color: var(--accent-ink); }
.j-st.failed { color: var(--danger); }
.j-st.done { color: var(--ok); }
.s { font-size: 22rpx; }
.j-t { font-size: 28rpx; font-weight: 600; margin: 14rpx 0 6rpx; }
.prog { height: 8rpx; border-radius: 4rpx; background: var(--panel-2); overflow: hidden; margin: 12rpx 0 4rpx; }
.prog-in { height: 100%; width: 35%; background: var(--accent); border-radius: 4rpx; animation: prog 1.4s ease-in-out infinite; }
.prog-in.queued { background: var(--line-strong); animation: none; width: 12%; }
@keyframes prog { 0% { margin-left: -35%; } 100% { margin-left: 100%; } }
.j-err { font-size: 24rpx; color: var(--danger); margin-top: 6rpx; }
.j-acts { display: flex; justify-content: flex-end; gap: 16rpx; margin-top: 12rpx; }
.j-acts:empty { display: none; }
</style>
