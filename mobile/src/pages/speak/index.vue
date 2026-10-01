<template>
  <view class="page">
    <TopBar title="口播" />
    <!-- 口播：先看欠着的（有提示没合格录音），再看最近的评测记录。网络不好存在本机的，在这里补交 -->
    <view v-if="local.length" class="card">
      <view class="card-h"><Ic name="cloud-off" :size="30" color="#c76a00" /><text class="card-t sm">待上传</text><view class="grow"></view><text class="faint">{{ local.length }} 遍</text></view>
      <view v-for="t in local" :key="t.path" class="row-i">
        <view class="grow"><view class="ellipsis">{{ t.title || '未命名' }}</view><view class="faint s">{{ ago(t.at) }} 录的，存在本机</view></view>
        <button class="btn small primary" :loading="sending === t.path" @tap="send(t)">上传</button>
      </view>
    </view>

    <view class="card">
      <view class="card-h"><text class="card-t">待练口播</text><text class="card-sub">有口播提示、还没合格录音</text></view>
      <view v-if="loading" class="skel" style="height: 120rpx"></view>
      <view v-for="x in todo" :key="x.id" class="row-i">
        <view class="grow ellipsis">《{{ x.title || '未命名' }}》</view>
        <button class="btn small primary" @tap="go('speak/record', { id: x.id })"><Ic name="video" :size="26" color="#ffffff" />去录</button>
      </view>
      <view v-if="!loading && !todo.length" class="hint">没有欠着的。成稿页「更多 → 口播」能给一篇生成口播提示。</view>
    </view>

    <view class="card">
      <view class="card-h"><text class="card-t">评测记录</text><view class="grow"></view><text class="faint">{{ speaks.length }} 遍</text></view>
      <view v-for="x in speaks" :key="x.id" class="sp-i" @tap="go('speak/result', { id: x.id })">
        <view class="score" :class="tone(x)">{{ x.status === 'ready' && x.score != null ? x.score : x.status === 'failed' ? '!' : '…' }}</view>
        <view class="grow">
          <view class="ellipsis">{{ x.title || '未命名' }}</view>
          <view class="faint s ellipsis">{{ ago(x.createdAt) }} · {{ x.status === 'running' ? '正在转写和总评' : x.status === 'failed' ? (x.error || '评估失败') : (x.next || '看总评') }}</view>
        </view>
        <Ic name="chev-right" :size="28" color="#98a2b3" />
      </view>
      <view v-if="!loading && !speaks.length" class="empty">还没有口播记录。挑一篇成稿，录一遍试试。</view>
    </view>
  </view>
</template>

<script setup>
import { ref } from 'vue';
import { onPullDownRefresh, onShow, onUnload } from '@dcloudio/uni-app';
import TopBar from '../../components/TopBar.vue';
import Ic from '../../components/Ic.vue';
import { api, uploadBytes } from '../../lib/api.js';
import { go, toast } from '../../lib/ui.js';
import { ago } from '../../lib/text.js';
import { dropTake, takes } from '../../lib/takes.js';
import { useAccountStore } from '../../stores/account.js';
import { useSessionStore } from '../../stores/session.js';

const acc = useAccountStore();
const session = useSessionStore();
const todo = ref([]);
const speaks = ref([]);
const local = ref([]);
const loading = ref(false);
const sending = ref('');

const tone = (x) => (x.score == null ? '' : x.score >= 80 ? 'good' : x.score >= 60 ? 'mid' : 'low');

async function load() {
  if (!session.user) return;
  loading.value = true;
  local.value = takes();
  try {
    const p = acc.currentId ? `?persona=${acc.currentId}` : '';
    const [t, s] = await Promise.all([api(`/today${p}`), api('/speaks')]);
    todo.value = t.speakTodo || [];
    speaks.value = s.speaks || [];
  } catch (err) { toast(err.message); } finally { loading.value = false; uni.stopPullDownRefresh(); }
}

async function send(t) {
  sending.value = t.path;
  try {
    await uploadBytes(`/drafts/${t.draftId}/speaks?async=1`, t.path, { type: t.type, filename: t.filename });
    dropTake(t.path);
    toast('已交给评测', 'success');
    load();
  } catch (err) { toast(err.message); } finally { sending.value = ''; }
}

const onPersona = () => load();
uni.$on('persona-changed', onPersona);
onUnload(() => uni.$off('persona-changed', onPersona));
onShow(load);
onPullDownRefresh(load);
</script>

<style lang="scss" scoped>
.card-t.sm { font-size: 28rpx; margin-left: 8rpx; }
.row-i { display: flex; align-items: center; gap: 20rpx; padding: 20rpx 0; border-top: 2rpx solid var(--border); font-size: 28rpx; }
.s { font-size: 22rpx; margin-top: 4rpx; }
.sp-i { display: flex; align-items: center; gap: 20rpx; padding: 20rpx 0; border-top: 2rpx solid var(--border); font-size: 28rpx; }
.score { width: 84rpx; height: 84rpx; border-radius: 20rpx; display: flex; align-items: center; justify-content: center; font-size: 32rpx; font-weight: 700; background: var(--panel-2); color: var(--muted); flex: none; }
.score.good { background: var(--ok-soft); color: var(--ok); }
.score.mid { background: var(--accent-soft); color: var(--accent-ink); }
.score.low { background: var(--danger-soft); color: var(--danger); }
</style>
