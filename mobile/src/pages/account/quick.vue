<template>
  <view class="page qk">
    <!-- 快速建号：贴自我介绍（可语音）→ 帮你填好设定 → 预览可改 → 保存；也可以自己一项项填。
         建号和「发后喂样本」是同一条链：旧文章贴进来会顺手存成语气样本 -->
    <view v-if="first" class="welcome">先给这个号定个位，之后每篇都会带上这份语境。</view>
    <view class="seg wrap-seg">
      <view class="seg-i" :class="{ on: mode === 'ai' }" @tap="mode = 'ai'">帮我填</view>
      <view class="seg-i" :class="{ on: mode === 'manual' }" @tap="mode = 'manual'">自己一项项填</view>
    </view>

    <view v-if="mode === 'ai' && !filled" class="card">
      <view class="label">贴一段自我介绍</view>
      <view class="row gap">
        <view class="hint grow">做什么的、写给谁、想解决什么问题。说的比打的快：按住右边的麦克风说</view>
        <view class="mic" :class="{ rec: recording }" @touchstart.prevent="down" @touchend.prevent="up"><Ic name="mic" :size="40" color="#ffffff" /></view>
      </view>
      <textarea class="area" v-model="intro" maxlength="3000" placeholder="例：我做了 8 年产品经理，二胎妈妈。在小红书写职场妈妈怎么安排时间…" placeholder-class="ph" style="margin-top: 16rpx" />
      <view class="label" style="margin-top: 28rpx">以前写过的文章<text class="opt">（选填，多篇用 --- 分隔）</text></view>
      <textarea class="area" v-model="posts" maxlength="20000" placeholder="会存成语气样本，之后的成稿更像你自己写的" placeholder-class="ph" />
      <view class="hint" style="margin-top: 12rpx">只填介绍里看得出来的，看不出来的留空，不替你编。</view>
    </view>

    <view v-if="mode === 'manual' || filled" class="card">
      <view v-if="filled" class="filled"><Ic name="check-circle" :size="30" color="#16a34a" />已按你的介绍填好{{ blank ? `，${blank} 项看不出来留空了` : '' }}。检查一下再保存</view>
      <view class="field"><view class="label">账号名称<text class="req">*</text></view><input class="input" v-model="f.name" maxlength="40" placeholder="例：下班后的厨房" placeholder-class="ph" /></view>
      <view class="field"><view class="label">发布平台</view>
        <picker :range="platforms" range-key="label" :value="pIdx" @change="(e) => (f.platform = platforms[e.detail.value].key)"><view class="input row">{{ session.platformLabel(f.platform) || '选一个' }}</view></picker></view>
      <view class="field"><view class="label">主要内容（定位）</view><textarea class="area sm" v-model="f.content_focus" :auto-height="true" maxlength="500" placeholder="这个号主要写什么" placeholder-class="ph" /></view>
      <view class="field"><view class="label">目标用户</view><textarea class="area sm" v-model="f.audience" :auto-height="true" maxlength="500" placeholder="给谁看" placeholder-class="ph" /></view>
      <view class="field"><view class="label">解决的问题</view><textarea class="area sm" v-model="f.problem" :auto-height="true" maxlength="500" placeholder="读者的痛点" placeholder-class="ph" /></view>
      <view v-if="samples.length" class="hint">保存后 {{ samples.length }} 篇旧文章会存成语气样本。</view>
    </view>

    <view class="footer-pad"></view>
    <view class="footer">
      <button v-if="mode === 'ai' && !filled" class="btn primary lg block" :loading="busy" :disabled="busy" @tap="run"><Ic name="sparkles" :size="32" color="#ffffff" />帮我填好账号设定</button>
      <button v-else class="btn primary lg block" :loading="busy" :disabled="busy" @tap="save">保存账号</button>
      <view v-if="first" class="skip" @tap="skip">先不设定，直接用</view>
    </view>
  </view>
</template>

<script setup>
import { computed, reactive, ref } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import Ic from '../../components/Ic.vue';
import { api, uploadBytes } from '../../lib/api.js';
import { toast } from '../../lib/ui.js';
import { createRecorder } from '../../lib/recorder.js';
import { useSessionStore } from '../../stores/session.js';
import { useAccountStore } from '../../stores/account.js';

const session = useSessionStore();
const acc = useAccountStore();
const mode = ref('ai');
const first = ref(false);
const intro = ref('');
const posts = ref('');
const busy = ref(false);
const filled = ref(false);
const blank = ref(0);
const samples = ref([]);
const recording = ref(false);
const f = reactive({ name: '', platform: '', tone: '', content_focus: '', audience: '', problem: '', notes: '' });
let rec = null;

const platforms = computed(() => session.meta?.platforms || []);
const pIdx = computed(() => Math.max(0, platforms.value.findIndex((p) => p.key === f.platform)));

onLoad((q) => {
  first.value = q.first === '1';
  f.platform = platforms.value[0]?.key || '';
  f.tone = session.meta?.tones?.[0]?.key || '';
});

async function down() {
  rec = createRecorder();
  try { await rec.start(); recording.value = true; } catch { toast('打不开麦克风'); }
}
async function up() {
  if (!recording.value) return;
  recording.value = false;
  const file = await rec.stop();
  if (!file) return;
  uni.showLoading({ title: '转成文字…' });
  try {
    const { text } = await uploadBytes('/transcribe', file.path, { type: file.type, filename: file.filename });
    intro.value = intro.value ? `${intro.value}\n${text}` : text;
  } catch (err) { toast(err.message); } finally { uni.hideLoading(); }
}

async function run() {
  if (intro.value.trim().length < 10) { toast('自我介绍多写几句'); return; }
  busy.value = true;
  try {
    const out = await api('/personas/quickstart', { method: 'POST', body: { intro: intro.value, posts: posts.value } });
    for (const [k, v] of Object.entries(out.fields || {})) if (v && k in f) f[k] = v;
    samples.value = out.samples || [];
    blank.value = (out.empty || []).length;
    filled.value = true;
  } catch (err) { toast(err.message); } finally { busy.value = false; }
}

async function save() {
  if (!f.name.trim()) { toast('起个账号名'); return; }
  busy.value = true;
  try {
    const { persona } = await api('/personas', { method: 'POST', body: { ...f } });
    if (samples.value.length) {
      try {
        const out = await api(`/personas/${persona.id}/samples/batch`, { method: 'POST', body: { samples: samples.value } });
        toast(`已创建，存了 ${out.added} 篇语气样本`);
      } catch (err) { toast(`账号建好了，样本没存上：${err.message}`); }
    } else toast('账号建好了', 'success');
    await acc.load();
    acc.select(persona.id);
    setTimeout(() => uni.switchTab({ url: '/pages/today/index' }), 600);
  } catch (err) { toast(err.message); } finally { busy.value = false; }
}

function skip() { uni.switchTab({ url: '/pages/today/index' }); }
</script>

<style lang="scss" scoped>
.qk { padding-top: 20rpx; }
.welcome { margin: 0 28rpx 20rpx; padding: 20rpx 24rpx; border-radius: 16rpx; background: var(--accent-soft); color: var(--accent-ink); font-size: 26rpx; }
.wrap-seg { margin: 0 28rpx 20rpx; background: var(--panel); }
.row.gap { display: flex; align-items: center; gap: 20rpx; }
.row { display: flex; align-items: center; }
.mic { width: 96rpx; height: 96rpx; border-radius: 50%; background: var(--accent); display: flex; align-items: center; justify-content: center; flex: none; }
.mic.rec { background: #f04438; }
.filled { display: flex; align-items: center; gap: 10rpx; padding: 16rpx 20rpx; border-radius: 14rpx; background: var(--ok-soft); color: #15703a; font-size: 24rpx; margin-bottom: 24rpx; }
.req { color: var(--danger); }
.area.sm { min-height: 90rpx; }
.skip { text-align: center; font-size: 26rpx; color: var(--muted); padding-top: 16rpx; }
</style>
