<template>
  <view class="page">
    <!-- 发布包：改完就能去各 App 粘贴。按平台分段，每块可以单独复制，也能一次复制全部 -->
    <view v-if="!pk" class="wrap"><view v-for="i in 4" :key="i" class="skel" style="height: 160rpx; margin-bottom: 20rpx"></view></view>
    <template v-else>
      <scroll-view scroll-x class="plats" :show-scrollbar="false">
        <view v-for="(p, i) in pk.platforms" :key="p.key + i" class="plat" :class="{ on: cur === i }" @tap="cur = i">
          {{ p.label }}<text v-if="p.original" class="orig">原文</text>
        </view>
      </scroll-view>
      <view v-if="!pk.platforms.length" class="empty">这篇还没有正文。</view>

      <template v-if="p">
        <view class="card blk">
          <view class="blk-h"><text class="blk-t">标题</text><text class="cnt" :class="{ over: p.checks.titleOver }">{{ p.checks.titleChars }}{{ p.limits.title ? ` / ${p.limits.title}` : '' }} 字</text>
            <text v-if="p.checks.titleOver" class="chip bad">超出</text><text v-else-if="p.limits.title" class="chip ok">符合</text>
            <view class="grow"></view><view class="cp" @tap="copy(p.title, '标题已复制')"><Ic name="copy" :size="28" color="#2f6bff" />复制</view></view>
          <view class="blk-v title">{{ p.title || '（没有标题）' }}</view>
          <view v-if="p.checks.titleOver" class="warn-t">这个平台标题不超过 {{ p.limits.title }} 字，去「标题候选」换一个</view>
        </view>

        <view class="card blk">
          <view class="blk-h"><text class="blk-t">正文</text><text class="cnt" :class="{ over: p.checks.bodyOver }">{{ p.checks.bodyChars }} 字</text>
            <view class="grow"></view><view class="cp" @tap="copy(p.body, '正文已复制')"><Ic name="copy" :size="28" color="#2f6bff" />复制</view></view>
          <view class="blk-v body" :class="{ fold: !open }">{{ p.body }}</view>
          <view class="unfold" @tap="open = !open">{{ open ? '收起' : '展开全文' }}</view>
        </view>

        <view class="card blk">
          <view class="blk-h"><text class="blk-t">话题标签</text><view class="grow"></view><view v-if="p.tags.length" class="cp" @tap="copy(tagLine, '标签已复制')"><Ic name="copy" :size="28" color="#2f6bff" />复制</view></view>
          <view v-if="p.tags.length" class="tags"><text v-for="t in p.tags" :key="t" class="tag">#{{ t }}</text></view>
          <view v-else class="hint">正文里没有 #话题。需要的话发的时候在平台里加。</view>
        </view>

        <view class="card blk">
          <view class="blk-h"><text class="blk-t">配图</text><text class="cnt">{{ p.images.length }} 张</text><view class="grow"></view>
            <view v-if="p.images.length" class="cp" @tap="copy(captionLine, '配图说明已复制')"><Ic name="copy" :size="28" color="#2f6bff" />说明</view></view>
          <view v-if="p.images.length" class="imgs">
            <view v-for="(im, k) in p.images" :key="k" class="img">
              <image :src="srcs[im.url] || ''" mode="aspectFill" class="img-i" @tap="preview(k)" />
              <view class="img-a ellipsis">{{ im.alt || `第 ${k + 1} 张` }}</view>
            </view>
          </view>
          <view v-else class="hint">这个版本还没出图。<text class="link" @tap="go('create/illus', { id })">去配图</text></view>
          <button v-if="p.images.length" class="btn soft block" style="margin-top: 20rpx" :loading="saving" @tap="saveAll"><Ic name="download" :size="30" color="#1f56e0" />配图全部保存到相册</button>
          <view v-if="denied" class="denied"><Ic name="lock" :size="28" color="#c76a00" /><text class="grow">没有相册权限，存不了图</text><text class="link" @tap="openSettings">去开启</text></view>
        </view>
      </template>
    </template>
    <view class="footer-pad"></view>
    <view v-if="p" class="footer row gap2">
      <button class="btn lg" @tap="go('create/titles', { id })">换标题</button>
      <button class="btn primary lg grow" @tap="copyAll"><Ic name="copy" :size="32" color="#ffffff" />一次复制全部</button>
    </view>
  </view>
</template>

<script setup>
import { computed, reactive, ref, watch } from 'vue';
import { onLoad, onShow } from '@dcloudio/uni-app';
import Ic from '../../components/Ic.vue';
import { api } from '../../lib/api.js';
import { copy, go, toast } from '../../lib/ui.js';
import { authedImage, openSettings, saveToAlbum } from '../../lib/image.js';

const pk = ref(null);
const cur = ref(0);
const open = ref(false);
const saving = ref(false);
const denied = ref(false);
const srcs = reactive({});
let id = 0;

const p = computed(() => pk.value?.platforms?.[cur.value] || null);
const tagLine = computed(() => (p.value?.tags || []).map((t) => `#${t}`).join(' '));
const captionLine = computed(() => (p.value?.images || []).map((im, i) => `图${i + 1}：${im.alt || ''}`).join('\n'));

async function load() {
  try { pk.value = await api(`/drafts/${id}/package`); } catch (err) { toast(err.message); }
}
onLoad((q) => { id = Number(q.id); load(); });
onShow(() => { if (pk.value) load(); });

// 当前平台的图：带登录态下载成本地地址再显示
watch(p, async (v) => {
  for (const im of v?.images || []) if (!srcs[im.url]) srcs[im.url] = await authedImage(im.url);
}, { immediate: true });

function copyAll() {
  const x = p.value;
  const parts = [x.title, '', x.body];
  if (x.tags.length) parts.push('', tagLine.value);
  copy(parts.join('\n'), '整份已复制，去平台粘贴吧');
}

function preview(k) {
  const urls = (p.value?.images || []).map((im) => srcs[im.url]).filter(Boolean);
  if (urls.length) uni.previewImage({ urls, current: urls[k] || urls[0] });
}

async function saveAll() {
  saving.value = true;
  denied.value = false;
  let ok = 0;
  for (const im of p.value.images) {
    const r = await saveToAlbum(im.url);
    if (r === 'ok') ok += 1;
    if (r === 'denied') { denied.value = true; break; }
  }
  saving.value = false;
  if (ok) toast(`已保存 ${ok} 张到相册`, 'success');
}
</script>

<style lang="scss" scoped>
.plats { white-space: nowrap; padding: 16rpx 28rpx 20rpx; }
.plat { display: inline-flex; align-items: center; gap: 8rpx; padding: 14rpx 28rpx; margin-right: 14rpx; border-radius: 32rpx; background: var(--panel); font-size: 26rpx; }
.plat.on { background: var(--accent); color: #fff; font-weight: 600; }
.orig { font-size: 20rpx; opacity: .8; }
.blk-h { display: flex; align-items: center; gap: 12rpx; margin-bottom: 14rpx; }
.blk-t { font-size: 28rpx; font-weight: 700; }
.cnt { font-size: 22rpx; color: var(--muted); }
.cnt.over { color: var(--danger); }
.cp { display: flex; align-items: center; gap: 6rpx; font-size: 24rpx; color: var(--accent-ink); padding: 8rpx 0 8rpx 16rpx; }
.blk-v.title { font-size: 32rpx; font-weight: 600; line-height: 1.5; }
.blk-v.body { font-size: 28rpx; line-height: 1.8; white-space: pre-wrap; color: var(--text); }
.blk-v.fold { max-height: 400rpx; overflow: hidden; }
.unfold { text-align: center; font-size: 24rpx; color: var(--accent-ink); padding-top: 14rpx; }
.warn-t { font-size: 24rpx; color: var(--danger); margin-top: 10rpx; }
.tags { display: flex; flex-wrap: wrap; gap: 12rpx; }
.tag { font-size: 26rpx; color: var(--accent-ink); background: var(--accent-soft); padding: 6rpx 18rpx; border-radius: 30rpx; }
.imgs { display: flex; flex-wrap: wrap; gap: 16rpx; }
.img { width: calc(33.33% - 11rpx); }
.img-i { width: 100%; height: 200rpx; border-radius: 12rpx; background: var(--panel-2); }
.img-a { font-size: 22rpx; color: var(--muted); margin-top: 6rpx; }
.link { color: var(--accent-ink); }
.denied { display: flex; align-items: center; gap: 12rpx; margin-top: 16rpx; padding: 16rpx 20rpx; border-radius: 12rpx; background: var(--warn-soft); font-size: 24rpx; color: var(--warn); }
.row.gap2 { display: flex; gap: 20rpx; }
.row.gap2 .btn.lg:first-child { flex: none; padding: 0 32rpx; }
</style>
