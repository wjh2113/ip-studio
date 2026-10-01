<template>
  <view class="page fd">
    <!-- 发后喂语气：刚发出去的、自己满意的旧文，贴进来存成语气样本，再重建语气档案。以后的成稿更像你 -->
    <view class="card">
      <view class="label">喂给哪个号</view>
      <picker :range="acc.list" range-key="name" :value="idx" @change="(e) => (pid = acc.list[e.detail.value].id)">
        <view class="input row">{{ acc.list[idx]?.name || '先建一个账号' }}</view>
      </picker>
      <view class="label" style="margin-top: 28rpx">文章标题<text class="opt">（选填）</text></view>
      <input class="input" v-model="title" maxlength="120" placeholder="方便以后认出是哪篇" placeholder-class="ph" />
      <view class="label" style="margin-top: 28rpx">正文<view class="grow"></view><text class="link" @tap="paste">从剪贴板粘贴</text></view>
      <textarea class="area" v-model="content" maxlength="20000" placeholder="至少 100 字才学得出语气" placeholder-class="ph" />
      <view class="faint s">{{ content.replace(/\s/g, '').length }} 字</view>
    </view>

    <view v-if="step" class="card prog">
      <view v-for="(s, i) in STEPS" :key="s" class="st" :class="{ done: step > i + 1, on: step === i + 1 }">
        <view class="st-dot"><Ic v-if="step > i + 1" name="check" :size="22" color="#ffffff" :stroke="3" /></view><text>{{ s }}</text>
      </view>
      <view v-if="step > STEPS.length" class="ok-t">学好了。以后这个号的成稿会更像你写的。</view>
    </view>

    <view v-if="samples.length" class="card">
      <view class="card-h"><text class="card-t">已有样本</text><view class="grow"></view><text class="faint">{{ samples.length }} / 30</text></view>
      <view v-for="x in samples.slice(0, 8)" :key="x.id" class="smp"><text class="grow ellipsis">{{ x.title || '未命名样本' }}</text><text class="faint">{{ x.length }} 字</text></view>
    </view>

    <view class="footer-pad"></view>
    <view class="footer"><button class="btn primary lg block" :loading="busy" :disabled="busy" @tap="feed">加入语气样本并重建档案</button></view>
  </view>
</template>

<script setup>
import { computed, ref, watch } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import Ic from '../../components/Ic.vue';
import { api } from '../../lib/api.js';
import { toast } from '../../lib/ui.js';
import { useAccountStore } from '../../stores/account.js';

const STEPS = ['存成样本', '重建语气档案'];
const acc = useAccountStore();
const pid = ref(acc.currentId || acc.list[0]?.id || null);
const title = ref('');
const content = ref('');
const busy = ref(false);
const step = ref(0);
const samples = ref([]);

const idx = computed(() => Math.max(0, acc.list.findIndex((p) => p.id === pid.value)));

async function loadSamples() {
  if (!pid.value) return;
  try { samples.value = (await api(`/personas/${pid.value}/samples`)).samples || []; } catch { samples.value = []; }
}
onLoad(loadSamples);
watch(pid, loadSamples);

function paste() { uni.getClipboardData({ success: (r) => { content.value = String(r.data || ''); } }); }

async function feed() {
  if (!pid.value) { toast('先建一个账号'); return; }
  if (content.value.replace(/\s/g, '').length < 100) { toast('至少 100 字才学得出语气'); return; }
  busy.value = true;
  step.value = 1;
  try {
    await api(`/personas/${pid.value}/samples`, { method: 'POST', body: { title: title.value, content: content.value } });
    step.value = 2;
    await api(`/personas/${pid.value}/digest`, { method: 'POST', body: {} });
    step.value = 3;
    title.value = '';
    content.value = '';
    loadSamples();
  } catch (err) {
    toast(err.message);
    step.value = 0;
  } finally { busy.value = false; }
}
</script>

<style lang="scss" scoped>
.fd { padding-top: 20rpx; }
.row { display: flex; align-items: center; }
.link { color: var(--accent-ink); font-size: 24rpx; font-weight: 400; }
.s { font-size: 22rpx; text-align: right; margin-top: 8rpx; }
.prog { display: flex; flex-direction: column; gap: 18rpx; }
.st { display: flex; align-items: center; gap: 14rpx; font-size: 28rpx; color: var(--faint); }
.st-dot { width: 40rpx; height: 40rpx; border-radius: 50%; border: 3rpx solid var(--line-strong); display: flex; align-items: center; justify-content: center; }
.st.on { color: var(--accent-ink); font-weight: 600; }
.st.on .st-dot { border-color: var(--accent); border-top-color: transparent; animation: spin .8s linear infinite; }
.st.done { color: var(--text); }
.st.done .st-dot { background: var(--ok); border-color: var(--ok); }
@keyframes spin { to { transform: rotate(360deg); } }
.ok-t { font-size: 26rpx; color: #15703a; background: var(--ok-soft); padding: 16rpx 20rpx; border-radius: 14rpx; }
.smp { display: flex; gap: 16rpx; padding: 14rpx 0; border-top: 2rpx solid var(--border); font-size: 26rpx; }
</style>
