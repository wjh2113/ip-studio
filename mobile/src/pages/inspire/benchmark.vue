<template>
  <view class="page bm">
    <!-- 对标速存：贴一个主页或笔记链接，只抽标题和结构要点存成「我的对标」。不是爬虫，不做全网监控 -->
    <view class="card">
      <view class="label">粘贴主页或笔记链接</view>
      <view class="row gap">
        <input class="input grow" v-model="url" placeholder="https://…" placeholder-class="ph" confirm-type="go" @confirm="fetch" />
        <button class="btn small" @tap="paste">粘贴</button>
      </view>
      <view class="link-t" @tap="mode = mode === 'url' ? 'text' : 'url'">{{ mode === 'url' ? '打不开链接？改成贴正文' : '还是用链接' }}</view>
      <template v-if="mode === 'text'">
        <input class="input" v-model="title" placeholder="标题" placeholder-class="ph" style="margin-top: 16rpx" />
        <textarea class="area" v-model="pasted" maxlength="20000" placeholder="把文章正文贴进来" placeholder-class="ph" style="margin-top: 16rpx" />
      </template>
      <button class="btn primary block" style="margin-top: 24rpx" :loading="busy" :disabled="busy" @tap="fetch"><Ic name="sparkles" :size="30" color="#ffffff" />拉取可引用信息</button>
      <view class="hint" style="margin-top: 12rpx">只抽标题和结构要点，存成你自己的参考。不抄内容。</view>
    </view>

    <view v-if="cur" class="card res">
      <view class="res-t">{{ cur.title }}</view>
      <view v-for="(o, i) in cur.outline" :key="i" class="ol"><text class="ol-n">{{ i + 1 }}</text><text class="grow">{{ o }}</text></view>
      <view v-if="cur.url" class="src ellipsis">来源：{{ cur.url }}</view>
      <view class="row gap" style="margin-top: 24rpx">
        <button class="btn grow" :loading="saving === 'material'" @tap="save('material')">存进素材库</button>
        <button class="btn primary grow" :loading="saving === 'framework'" @tap="save('framework')">存为框架参考</button>
      </view>
      <view class="hint" style="margin-top: 12rpx">框架参考只学结构（每段干什么），写的时候用你自己的素材。</view>
    </view>

    <view class="card">
      <view class="card-h"><text class="card-t">我存过的对标</text><view class="grow"></view><text class="faint">{{ list.length }}</text></view>
      <view v-for="b in list" :key="b.id" class="bm-i" @tap="cur = b" @longpress="remove(b)">
        <view class="grow"><view class="ellipsis">{{ b.title }}</view><view class="faint s">{{ (b.outline || []).length }} 个要点 · {{ ago(b.created_at) }}</view></view>
        <Ic name="chev-right" :size="28" color="#98a2b3" />
      </view>
      <view v-if="!list.length" class="hint">还没存过。看到写得好的号，把链接贴进来。</view>
    </view>
  </view>
</template>

<script setup>
import { ref } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import Ic from '../../components/Ic.vue';
import { api } from '../../lib/api.js';
import { confirm, toast } from '../../lib/ui.js';
import { ago } from '../../lib/text.js';
import { useAccountStore } from '../../stores/account.js';

const acc = useAccountStore();
const url = ref('');
const title = ref('');
const pasted = ref('');
const mode = ref('url');
const busy = ref(false);
const saving = ref('');
const cur = ref(null);
const list = ref([]);

const pid = () => acc.currentId || acc.list[0]?.id;

async function load() {
  if (!pid()) return;
  try { list.value = (await api(`/personas/${pid()}/benchmarks`)).list || []; } catch { /* 列表拿不到不挡录入 */ }
}
onShow(load);

function paste() {
  uni.getClipboardData({ success: (r) => { const m = String(r.data || '').match(/https?:\/\/\S+/); if (m) url.value = m[0]; else toast('剪贴板里没有链接'); } });
}

async function fetch() {
  if (!pid()) { toast('先建一个账号'); return; }
  const body = mode.value === 'url' ? { url: url.value.trim() } : { text: pasted.value.trim(), title: title.value.trim() };
  if (mode.value === 'url' ? !body.url : !body.text) { toast(mode.value === 'url' ? '先贴链接' : '先贴正文'); return; }
  busy.value = true;
  try {
    cur.value = (await api(`/personas/${pid()}/benchmarks`, { method: 'POST', body })).benchmark;
    load();
  } catch (err) {
    toast(err.message);
    if (err.status === 422) mode.value = 'text';
  } finally { busy.value = false; }
}

async function save(to) {
  saving.value = to;
  try {
    await api(`/benchmarks/${cur.value.id}/save`, { method: 'POST', body: { to } });
    toast(to === 'material' ? '已存进素材库' : '已存为框架参考，创作时能选', 'success');
  } catch (err) { toast(err.message); } finally { saving.value = ''; }
}

async function remove(b) {
  if (!(await confirm({ title: '删掉这条对标？', ok: '删除', danger: true }))) return;
  try { await api(`/benchmarks/${b.id}`, { method: 'DELETE' }); if (cur.value?.id === b.id) cur.value = null; load(); } catch (err) { toast(err.message); }
}
</script>

<style lang="scss" scoped>
.bm { padding-top: 20rpx; }
.row.gap { display: flex; gap: 16rpx; align-items: center; }
.link-t { font-size: 24rpx; color: var(--accent-ink); margin-top: 14rpx; }
.res-t { font-size: 32rpx; font-weight: 700; margin-bottom: 16rpx; }
.ol { display: flex; gap: 14rpx; font-size: 26rpx; line-height: 1.6; padding: 10rpx 0; }
.ol-n { width: 40rpx; height: 40rpx; border-radius: 50%; background: var(--accent-soft); color: var(--accent-ink); font-size: 22rpx; display: flex; align-items: center; justify-content: center; flex: none; }
.src { font-size: 22rpx; color: var(--faint); margin-top: 10rpx; }
.bm-i { display: flex; align-items: center; gap: 16rpx; padding: 20rpx 0; border-top: 2rpx solid var(--border); font-size: 28rpx; }
.s { font-size: 22rpx; }
</style>
