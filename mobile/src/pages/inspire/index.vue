<template>
  <view class="page">
    <TopBar title="灵感">
      <template #right>
        <view class="tasks" @tap="moreMenu"><Ic name="dots" :size="34" /></view>
      </template>
    </TopBar>
    <!-- 主入口：快速存素材；选题池和拍照仍走完整「记一条」 -->
    <view class="hero" @tap="go('inspire/quick')">
      <view class="hero-ic"><Ic name="mic" :size="48" color="#2f6bff" /></view>
      <view class="grow">
        <view class="hero-t">语音存到素材库</view>
        <view class="hero-p">点一下说，经网关转写后直接存</view>
      </view>
      <Ic name="chev-right" :size="30" color="#98a2b3" />
    </view>

    <view class="entries">
      <view class="entry blue" @tap="go('inspire/edit', { input: 'voice', to: 'material' })"><view class="e-ic"><Ic name="mic" :size="48" color="#2f6bff" /></view><text>语音记</text></view>
      <view class="entry violet" @tap="go('inspire/edit', { input: 'text', to: 'pool' })"><view class="e-ic"><Ic name="bulb" :size="48" color="#7c5cff" /></view><text>记选题</text></view>
      <view class="entry teal" @tap="go('inspire/edit', { input: 'photo', to: 'material' })"><view class="e-ic"><Ic name="camera" :size="48" color="#12b886" /></view><text>拍照记</text></view>
    </view>
    <view class="clip" @tap="fromClipboard"><Ic name="clipboard" :size="32" color="#1f56e0" /><text class="grow">从剪贴板导入到素材库</text><Ic name="chev-right" :size="28" color="#98a2b3" /></view>

    <view v-if="!inbox.online" class="offline"><Ic name="cloud-off" :size="30" color="#c76a00" />没有网络：记下的先存在手机上，联网后自动上传</view>
    <view v-else-if="inbox.pending.length" class="offline sync" @tap="inbox.flush()"><Ic name="refresh" :size="28" color="#1f56e0" />{{ inbox.syncing ? '正在同步…' : `${inbox.pending.length} 条待同步，点这里重试` }}</view>

    <view class="seg wrap-seg">
      <view v-for="f in FILTERS" :key="f.key" class="seg-i" :class="{ on: filter === f.key }" @tap="filter = f.key">{{ f.label }}</view>
    </view>

    <view v-for="x in list" :key="x.key" class="item" @longpress="remove(x)">
      <view class="it-ic" :class="x.input"><Ic :name="INPUT_ICON[x.input] || 'pen'" :size="34" :color="INPUT_COLOR[x.input] || '#2f6bff'" /></view>
      <view class="grow it-b">
        <view class="it-t ellipsis">{{ x.kind === 'pool' ? x.subject : x.title }}</view>
        <view class="it-p">{{ x.kind === 'pool' ? x.note : x.body }}</view>
        <view class="it-m">
          <text class="chip" :class="x.kind === 'pool' ? '' : 'teal'">{{ x.kind === 'pool' ? '选题池' : `素材 · ${x.materialKind || '文章'}` }}</text>
          <text class="faint">{{ ago(x.createdAt) }}</text>
          <view class="grow"></view>
          <view class="sync-s" :class="x.state"><Ic :name="x.state === 'synced' ? 'cloud' : x.state === 'failed' ? 'info' : 'cloud-off'" :size="26" :color="x.state === 'synced' ? '#16a34a' : x.state === 'failed' ? '#e5484d' : '#98a2b3'" />{{ STATE_TEXT[x.state] }}</view>
        </view>
        <view v-if="x.state === 'failed'" class="err">{{ x.error }}</view>
      </view>
    </view>
    <view v-if="!list.length" class="empty">
      <Ic name="bulb" :size="96" color="#98a2b3" />
      <view>{{ filter === 'pending' ? '都同步好了' : '还没记过。点上面麦克风入口，说一段就能存进素材库。' }}</view>
    </view>
    <view style="height: 40rpx"></view>
  </view>
</template>

<script setup>
import { computed, ref } from 'vue';
import { onPullDownRefresh } from '@dcloudio/uni-app';
import TopBar from '../../components/TopBar.vue';
import Ic from '../../components/Ic.vue';
import { confirm, go, sheet, toast } from '../../lib/ui.js';
import { ago } from '../../lib/text.js';
import { useInboxStore } from '../../stores/inbox.js';

const FILTERS = [{ key: 'all', label: '全部' }, { key: 'material', label: '素材库' }, { key: 'pool', label: '选题池' }, { key: 'pending', label: '未同步' }];
const INPUT_ICON = { voice: 'mic', text: 'pen', photo: 'camera', clip: 'clipboard', share: 'link' };
const INPUT_COLOR = { voice: '#2f6bff', text: '#7c5cff', photo: '#12b886', clip: '#c76a00', share: '#1f56e0' };
const STATE_TEXT = { synced: '已同步', pending: '待同步', failed: '失败' };

const inbox = useInboxStore();
const filter = ref('all');

const list = computed(() => inbox.items.filter((x) => {
  if (filter.value === 'pending') return x.state !== 'synced';
  if (filter.value === 'all') return true;
  return x.kind === filter.value;
}));

function fromClipboard() {
  uni.getClipboardData({
    success: (r) => {
      const text = String(r.data || '').trim();
      if (!text) { toast('剪贴板是空的'); return; }
      go('inspire/quick', { text: text.slice(0, 2000) });
    },
    fail: () => toast('读不到剪贴板'),
  });
}

async function remove(x) {
  if (x.state === 'synced') { toast('已同步的去网页端的选题池 / 素材库里删'); return; }
  if (await confirm({ title: '删掉这条？', content: '还没同步，删了就没了。', ok: '删除', danger: true })) inbox.remove(x.key);
}

async function moreMenu() {
  const i = await sheet(['完整记一条', '对标速存', '快速建号', '喂给语气样本']);
  if (i === 0) go('inspire/edit', { input: 'text', to: 'material' });
  if (i === 1) go('inspire/benchmark');
  if (i === 2) go('account/quick');
  if (i === 3) go('account/feed');
}

onPullDownRefresh(async () => { await inbox.flush(); uni.stopPullDownRefresh(); });
</script>

<style lang="scss" scoped>
.hero {
  display: flex; align-items: center; gap: 20rpx; margin: 8rpx 28rpx 20rpx; padding: 28rpx 24rpx;
  border-radius: 24rpx; background: linear-gradient(135deg, #eef3ff, #f7f9ff); border: 1rpx solid #d9e4ff;
}
.hero-ic {
  width: 88rpx; height: 88rpx; border-radius: 22rpx; background: #fff;
  display: flex; align-items: center; justify-content: center; flex: none;
  box-shadow: 0 8rpx 20rpx -12rpx rgba(47, 107, 255, .45);
}
.hero-t { font-size: 32rpx; font-weight: 700; color: var(--text); }
.hero-p { font-size: 24rpx; color: var(--muted); margin-top: 6rpx; }
.entries { display: flex; gap: 20rpx; padding: 0 28rpx 20rpx; }
.entry { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 12rpx; padding: 28rpx 0; border-radius: 24rpx; background: var(--panel); font-size: 26rpx; font-weight: 600; }
.e-ic { width: 88rpx; height: 88rpx; border-radius: 50%; display: flex; align-items: center; justify-content: center; }
.entry.blue .e-ic { background: #eef3ff; }
.entry.violet .e-ic { background: #f1edff; }
.entry.teal .e-ic { background: #e6f8f1; }
.clip { display: flex; align-items: center; gap: 16rpx; margin: 0 28rpx 20rpx; padding: 24rpx; border-radius: 20rpx; background: var(--panel); font-size: 28rpx; }
.offline { display: flex; align-items: center; gap: 12rpx; margin: 0 28rpx 20rpx; padding: 18rpx 22rpx; border-radius: 16rpx; background: var(--warn-soft); color: var(--warn); font-size: 24rpx; }
.offline.sync { background: var(--accent-soft); color: var(--accent-ink); }
.wrap-seg { margin: 0 28rpx 20rpx; background: var(--panel); }
.item { display: flex; gap: 20rpx; margin: 0 28rpx 16rpx; padding: 24rpx; border-radius: 20rpx; background: var(--panel); }
.it-ic { width: 72rpx; height: 72rpx; border-radius: 18rpx; background: var(--panel-2); display: flex; align-items: center; justify-content: center; flex: none; }
.it-b { min-width: 0; }
.it-t { font-size: 28rpx; font-weight: 600; }
.it-p { font-size: 24rpx; color: var(--muted); line-height: 1.6; margin: 6rpx 0 12rpx; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.it-m { display: flex; align-items: center; gap: 14rpx; font-size: 22rpx; }
.sync-s { display: flex; align-items: center; gap: 6rpx; color: var(--faint); }
.sync-s.synced { color: var(--ok); }
.sync-s.failed { color: var(--danger); }
.err { font-size: 22rpx; color: var(--danger); margin-top: 8rpx; }
</style>
