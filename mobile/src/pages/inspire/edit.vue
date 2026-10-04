<template>
  <view class="page ed">
    <!-- 完整记一条：可存选题池或素材库；素材归用户本人，不再强制挂账号 -->
    <view class="card">
      <view v-if="mode === 'voice'" class="talk-box">
        <view class="talk" :class="state" @touchstart.prevent="down" @touchend.prevent="up" @touchcancel="up">
          <Ic :name="state === 'busy' ? 'refresh' : 'mic'" :size="60" color="#ffffff" />
        </view>
        <view class="hint">{{ state === 'rec' ? '松开结束' : state === 'busy' ? '正在转成文字…' : '按住说，松开转成文字；没网时用输入法的语音输入' }}</view>
      </view>

      <view v-if="mode === 'photo'" class="photo">
        <image v-if="photo" :src="photo" mode="aspectFill" class="ph-img" @tap="pickPhoto" />
        <view v-else class="ph-empty" @tap="pickPhoto"><Ic name="camera" :size="64" color="#98a2b3" /><text>拍照或从相册选</text></view>
      </view>

      <view v-if="link" class="link-card"><Ic name="link" :size="30" color="#1f56e0" /><text class="grow ellipsis">{{ link }}</text></view>

      <view class="label" style="margin-top: 12rpx">{{ mode === 'photo' ? '这张图说的是什么' : '内容' }}</view>
      <textarea class="area" v-model="content" maxlength="2000" :auto-height="true" :focus="mode === 'text'" placeholder="想到什么写什么，之后再整理" placeholder-class="ph" />
    </view>

    <view class="card">
      <view class="label">存到</view>
      <view class="seg">
        <view class="seg-i" :class="{ on: kind === 'material' }" @tap="kind = 'material'">素材库</view>
        <view class="seg-i" :class="{ on: kind === 'pool' }" @tap="kind = 'pool'">选题池</view>
      </view>
      <view v-if="kind === 'pool'" class="hint" style="margin-top: 14rpx">以后想写的题材。创作时从选题池一点就能用。</view>
      <template v-else>
        <view class="hint" style="margin-top: 14rpx">素材归你本人，所有账号写作时都能按题材召回。标题不填就用第一句。</view>
        <view class="label sub">种类</view>
        <view class="picks"><view v-for="k in KINDS" :key="k" class="pick" :class="{ on: matKind === k }" @tap="matKind = k">{{ k }}</view></view>
        <view class="label sub">内容性质<span class="opt">（可选）</span></view>
        <view class="picks"><view v-for="t in TAGS" :key="t" class="pick" :class="{ on: tagOn(t) }" @tap="toggleTag(t)">{{ t }}</view></view>
        <view class="label sub">标题<span class="opt">（可选）</span></view>
        <input class="input" v-model="title" maxlength="80" placeholder="不填就用内容第一句" placeholder-class="ph" />
      </template>

      <view v-if="kind === 'pool'" class="label sub">关联账号</view>
      <picker v-if="kind === 'pool'" :range="accounts" range-key="name" :value="accIdx" @change="(e) => (personaId = accounts[e.detail.value].id)">
        <view class="input row"><text class="grow">{{ accounts[accIdx]?.name || '不关联' }}</text><Ic name="chev-down" :size="28" color="#98a2b3" /></view>
      </picker>
    </view>

    <view class="footer-pad"></view>
    <view class="footer">
      <view v-if="!inbox.online" class="off-t"><Ic name="cloud-off" :size="26" color="#c76a00" />没有网络：已存本地，联网后自动上传</view>
      <button class="btn primary lg block" @tap="save">{{ kind === 'material' ? '存进素材库' : '存进选题池' }}</button>
    </view>
  </view>
</template>

<script setup>
import { computed, ref, watch } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import Ic from '../../components/Ic.vue';
import { readBytes, uploadBytes } from '../../lib/api.js';
import { back, toast } from '../../lib/ui.js';
import { createRecorder } from '../../lib/recorder.js';
import { useAccountStore } from '../../stores/account.js';
import { useInboxStore } from '../../stores/inbox.js';

const KINDS = ['文章', '图片', '视频', '链接', '语音'];
const TAGS = ['经历', '数据', '案例', '金句', '观察'];

const acc = useAccountStore();
const inbox = useInboxStore();
const mode = ref('text');
const content = ref('');
const link = ref('');
const photo = ref('');
const photoData = ref('');
const kind = ref('material');
const matKind = ref('文章');
const title = ref('');
const tagList = ref([]);
const personaId = ref(acc.currentId);
const state = ref('idle');
let rec = null;

const accounts = computed(() => [{ id: null, name: '不关联' }, ...acc.list]);
const accIdx = computed(() => Math.max(0, accounts.value.findIndex((a) => a.id === personaId.value)));
const tagOn = (t) => tagList.value.includes(t);
function toggleTag(t) {
  tagList.value = tagOn(t) ? tagList.value.filter((x) => x !== t) : [...tagList.value, t];
}

watch(mode, (m) => {
  if (m === 'photo' && matKind.value === '文章') matKind.value = '图片';
  if (m === 'voice' && matKind.value === '文章') matKind.value = '语音';
  if (m === 'share' && matKind.value === '文章') matKind.value = '链接';
});

onLoad((q) => {
  mode.value = q.input || 'text';
  kind.value = q.to === 'pool' ? 'pool' : 'material';
  let t = q.text || '';
  try { t = decodeURIComponent(t); } catch { /* 已经解过码的原样用 */ }
  const m = t.match(/https?:\/\/\S+/);
  if (m) { link.value = m[0]; content.value = t.replace(m[0], '').trim(); } else content.value = t;
  if (mode.value === 'photo') { matKind.value = '图片'; pickPhoto(); }
  if (mode.value === 'voice') matKind.value = '语音';
  if (mode.value === 'share' || mode.value === 'clip') {
    kind.value = 'material';
    if (link.value) matKind.value = '链接';
  }
});

async function down() {
  if (state.value !== 'idle') return;
  rec = createRecorder();
  try { await rec.start(); state.value = 'rec'; } catch { toast('打不开麦克风'); }
}
async function up() {
  if (state.value !== 'rec') return;
  const f = await rec.stop();
  if (!f) { state.value = 'idle'; return; }
  state.value = 'busy';
  try {
    const { text: t } = await uploadBytes('/transcribe', f.path, { type: f.type, filename: f.filename });
    content.value = content.value ? `${content.value}\n${t}` : t;
  } catch (err) {
    toast(err.status ? err.message : '没网转不了文字，用输入法的语音输入吧');
  } finally { state.value = 'idle'; }
}

function pickPhoto() {
  uni.chooseImage({
    count: 1, sizeType: ['compressed'], sourceType: ['camera', 'album'],
    success: async (r) => {
      const path = r.tempFilePaths[0];
      photo.value = path;
      try {
        const bytes = new Uint8Array(await readBytes(path));
        const png = bytes[0] === 0x89 && bytes[1] === 0x50;
        if (bytes.length > 2.5 * 1024 * 1024) { toast('图片太大了，换一张小点的'); photo.value = ''; return; }
        photoData.value = `data:image/${png ? 'png' : 'jpeg'};base64,${uni.arrayBufferToBase64(bytes.buffer)}`;
        matKind.value = '图片';
      } catch { toast('读不到这张图'); photo.value = ''; }
    },
  });
}

function save() {
  const body = [content.value.trim(), link.value ? `链接：${link.value}` : ''].filter(Boolean).join('\n');
  if (!body && !photoData.value) { toast('先写点什么'); return; }
  const first = (content.value.trim().split('\n')[0] || (photo.value ? '一张照片' : link.value)).slice(0, 60);
  if (kind.value === 'pool') {
    inbox.add({ kind: 'pool', input: mode.value, personaId: personaId.value, subject: first, note: body, image: photoData.value || undefined, source: '灵感' });
  } else {
    inbox.add({
      kind: 'material', input: mode.value, personaId: null,
      title: title.value.trim() || first, body, materialKind: matKind.value,
      tags: tagList.value.join('，'), image: photoData.value || undefined,
    });
  }
  toast(inbox.online ? '已保存' : '已存本地，联网后自动上传', 'success');
  setTimeout(() => back('inspire'), 500);
}
</script>

<style lang="scss" scoped>
.ed { padding-top: 20rpx; }
.talk-box { display: flex; flex-direction: column; align-items: center; gap: 16rpx; padding: 20rpx 0 28rpx; }
.talk { width: 150rpx; height: 150rpx; border-radius: 50%; background: var(--accent); display: flex; align-items: center; justify-content: center; }
.talk.rec { background: #f04438; transform: scale(1.06); }
.talk.busy { background: var(--faint); }
.photo { margin-bottom: 16rpx; }
.ph-img { width: 100%; height: 400rpx; border-radius: 16rpx; }
.ph-empty { height: 300rpx; border-radius: 16rpx; border: 2rpx dashed var(--line-strong); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12rpx; color: var(--muted); font-size: 26rpx; }
.link-card { display: flex; align-items: center; gap: 12rpx; padding: 18rpx; border-radius: 14rpx; background: var(--accent-soft); color: var(--accent-ink); font-size: 24rpx; margin-bottom: 12rpx; }
.label.sub { margin-top: 24rpx; font-size: 24rpx; }
.label .opt { margin-left: 10rpx; color: var(--faint); font-weight: 400; }
.picks { display: flex; flex-wrap: wrap; gap: 12rpx; margin-top: 12rpx; }
.pick {
  height: 56rpx; padding: 0 20rpx; border-radius: 999rpx; border: 1rpx solid var(--line);
  display: flex; align-items: center; font-size: 24rpx; color: var(--muted); background: var(--panel);
}
.pick.on { border-color: transparent; background: var(--accent-soft); color: var(--accent-ink); font-weight: 600; }
.row { display: flex; align-items: center; }
.off-t { display: flex; align-items: center; gap: 8rpx; font-size: 22rpx; color: var(--warn); margin-bottom: 12rpx; }
</style>
