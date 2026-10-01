<template>
  <view class="page ed">
    <!-- 记一条：内容（语音转写可改 / 照片 / 链接）→ 存到选题池或素材库 → 关联账号 → 保存。无网先存本地 -->
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
        <view class="seg-i" :class="{ on: kind === 'pool' }" @tap="kind = 'pool'">选题池</view>
        <view class="seg-i" :class="{ on: kind === 'material' }" @tap="kind = 'material'">素材库</view>
      </view>
      <view v-if="kind === 'pool'" class="hint" style="margin-top: 14rpx">以后想写的题材。创作时从选题池一点就能用。</view>
      <template v-else>
        <view class="hint" style="margin-top: 14rpx">真实的经历、数据、案例。写作时按题材自动召回，是模型唯一能用的事实来源。</view>
        <view class="label sub">种类</view>
        <view class="picks"><view v-for="k in KINDS" :key="k" class="pick" :class="{ on: matKind === k }" @tap="matKind = k">{{ k }}</view></view>
        <view class="label sub">标题</view>
        <input class="input" v-model="title" maxlength="80" placeholder="一句话说清这条是什么" placeholder-class="ph" />
        <view class="label sub">标签</view>
        <input class="input" v-model="tags" maxlength="200" placeholder="逗号分隔，召回时权重更高" placeholder-class="ph" />
      </template>

      <view class="label sub">关联账号</view>
      <picker :range="accounts" range-key="name" :value="accIdx" @change="(e) => (personaId = accounts[e.detail.value].id)">
        <view class="input row"><text class="grow">{{ accounts[accIdx]?.name || '不关联' }}</text><Ic name="chev-down" :size="28" color="#98a2b3" /></view>
      </picker>
      <view v-if="kind === 'material' && !personaId" class="warn-t">素材库要挂在某个账号下，先选一个账号</view>
    </view>

    <view class="footer-pad"></view>
    <view class="footer">
      <view v-if="!inbox.online" class="off-t"><Ic name="cloud-off" :size="26" color="#c76a00" />没有网络：已存本地，联网后自动上传</view>
      <button class="btn primary lg block" @tap="save">保存</button>
    </view>
  </view>
</template>

<script setup>
import { computed, ref } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import Ic from '../../components/Ic.vue';
import { readBytes, uploadBytes } from '../../lib/api.js';
import { back, toast } from '../../lib/ui.js';
import { createRecorder } from '../../lib/recorder.js';
import { useAccountStore } from '../../stores/account.js';
import { useInboxStore } from '../../stores/inbox.js';

const KINDS = ['经历', '数据', '案例', '金句', '观察'];

const acc = useAccountStore();
const inbox = useInboxStore();
const mode = ref('text');
const content = ref('');
const link = ref('');
const photo = ref('');
const photoData = ref('');
const kind = ref('pool');
const matKind = ref('观察');
const title = ref('');
const tags = ref('');
const personaId = ref(acc.currentId);
const state = ref('idle');
let rec = null;

const accounts = computed(() => [{ id: null, name: '不关联' }, ...acc.list]);
const accIdx = computed(() => Math.max(0, accounts.value.findIndex((a) => a.id === personaId.value)));

onLoad((q) => {
  mode.value = q.input || 'text';
  let t = q.text || '';
  try { t = decodeURIComponent(t); } catch { /* 已经解过码的原样用 */ }
  const m = t.match(/https?:\/\/\S+/);
  if (m) { link.value = m[0]; content.value = t.replace(m[0], '').trim(); } else content.value = t;
  if (mode.value === 'photo') pickPhoto();
  if (mode.value === 'share') kind.value = 'material';
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

/* 选图后压一下再转成 data URL：离线时要整张存在本机，太大存不下 */
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
      } catch { toast('读不到这张图'); photo.value = ''; }
    },
  });
}

function save() {
  const body = [content.value.trim(), link.value ? `链接：${link.value}` : ''].filter(Boolean).join('\n');
  if (!body && !photoData.value) { toast('先写点什么'); return; }
  if (kind.value === 'material' && !personaId.value) { toast('素材库要挂在某个账号下'); return; }
  const first = (content.value.trim().split('\n')[0] || (photo.value ? '一张照片' : link.value)).slice(0, 60);
  inbox.add(kind.value === 'pool'
    ? { kind: 'pool', input: mode.value, personaId: personaId.value, subject: first, note: body, image: photoData.value || undefined, source: '灵感' }
    : { kind: 'material', input: mode.value, personaId: personaId.value, title: title.value.trim() || first, body, materialKind: matKind.value, tags: tags.value.trim(), image: photoData.value || undefined });
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
.row { display: flex; align-items: center; }
.warn-t { font-size: 22rpx; color: var(--warn); margin-top: 10rpx; }
.off-t { display: flex; align-items: center; gap: 8rpx; font-size: 22rpx; color: var(--warn); margin-bottom: 12rpx; }
</style>
