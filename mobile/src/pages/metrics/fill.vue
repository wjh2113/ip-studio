<template>
  <view class="page mf">
    <!-- 回填发布数据：推送第 1 / 7 天直达这里。同一天再填会覆盖；全部清空并保存 = 删掉当天那份 -->
    <view v-if="draft" class="card">
      <view class="mf-t">{{ draft.title || draft.subject }}</view>
      <view class="mf-s">
        <text class="chip gray">发布 {{ form.published }}</text>
        <text v-if="dayNo != null" class="chip">今天是第 {{ dayNo }} 天</text>
        <text v-if="due" class="chip warn">该填第 {{ due }} 天的数了</text>
      </view>
    </view>

    <view class="card">
      <view class="two">
        <view class="field"><view class="label">发布日期</view><picker mode="date" :value="form.published" @change="(e) => (form.published = e.detail.value)"><view class="input row">{{ form.published }}</view></picker></view>
        <view class="field"><view class="label">记录日期</view><picker mode="date" :value="form.on" @change="onDay"><view class="input row">{{ form.on }}</view></picker></view>
      </view>
      <view v-if="platforms.length > 1" class="field">
        <view class="label">哪个平台的数</view>
        <view class="picks"><view v-for="p in platforms" :key="p" class="pick" :class="{ on: form.platform === p }" @tap="pickPlatform(p)">{{ session.platformLabel(p) }}</view></view>
      </view>
      <view class="nums">
        <view v-for="f in fields" :key="f.key" class="num">
          <view class="label sm">{{ f.label }}</view>
          <input class="input" type="number" v-model="form.values[f.key]" :placeholder="last?.[f.key] != null ? `上次 ${last[f.key]}` : '留空不记'" placeholder-class="ph" />
        </view>
      </view>
      <view class="field"><view class="label">备注</view><input class="input" v-model="form.note" maxlength="300" placeholder="例：被大号转了；标题改过一版" placeholder-class="ph" /></view>
      <view class="hint">隔几天可以再填一次，复盘按「发布后第 7 天」同口径比。</view>
    </view>

    <view v-if="history.length" class="card">
      <view class="card-h"><text class="card-t">历次回填</text></view>
      <view v-for="h in history" :key="h.id" class="hs" :class="{ on: h.capturedOn === form.on }">
        <text class="mono">{{ h.capturedOn.slice(5) }}</text>
        <text v-if="dayOf(h) != null" class="faint">第 {{ dayOf(h) }} 天</text>
        <text class="grow ellipsis">{{ nums(h) || h.note }}</text>
        <text class="del" @tap="del(h)">删除</text>
      </view>
    </view>

    <view class="footer-pad"></view>
    <view class="footer row gap">
      <button class="btn lg" @tap="go('metrics/insights')">看复盘</button>
      <button class="btn primary lg grow" :loading="saving" @tap="save">保存</button>
    </view>
  </view>
</template>

<script setup>
import { computed, reactive, ref } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import { api } from '../../lib/api.js';
import { confirm, go, toast } from '../../lib/ui.js';
import { localDay } from '../../lib/text.js';
import { useSessionStore } from '../../stores/session.js';

const session = useSessionStore();
const draft = ref(null);
const fields = ref([]);
const history = ref([]);
const platforms = ref([]);
const saving = ref(false);
const due = ref(0);
const form = reactive({ published: localDay(), on: localDay(), platform: '', note: '', values: {} });
let id = 0;

const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
const dayNo = computed(() => (form.published ? daysBetween(form.published, form.on) : null));
const dayOf = (h) => (form.published ? daysBetween(form.published, h.capturedOn) : null);
const same = (h) => (h.platform || draft.value?.platform) === form.platform;
const last = computed(() => history.value.find((h) => same(h) && h.capturedOn < form.on) || null);
const nums = (h) => fields.value.filter((f) => h[f.key] != null).map((f) => `${f.label} ${h[f.key]}`).join(' · ');

/* 当天已经记过就带出来改 */
function fill() {
  const hit = history.value.find((h) => same(h) && h.capturedOn === form.on);
  form.note = hit?.note || '';
  form.values = Object.fromEntries(fields.value.map((f) => [f.key, hit?.[f.key] ?? '']));
}

onLoad(async (q) => {
  id = Number(q.id);
  due.value = Number(q.day) || 0;
  try {
    const [{ draft: d }, meta, m] = await Promise.all([api(`/drafts/${id}`), api('/metrics'), api(`/drafts/${id}/metrics`)]);
    draft.value = d;
    fields.value = meta.fields || [];
    history.value = m.history || [];
    platforms.value = m.platforms?.length ? m.platforms : [d.platform];
    form.published = (d.published_at || '').slice(0, 10) || localDay();
    form.platform = d.platform;
    fill();
  } catch (err) { toast(err.message); }
});

function onDay(e) { form.on = e.detail.value; fill(); }
function pickPlatform(p) { form.platform = p; fill(); }

async function save() {
  if (saving.value) return;
  const body = { published_at: form.published, captured_on: form.on, platform: form.platform, note: form.note };
  for (const [k, v] of Object.entries(form.values)) if (v !== '' && v != null) body[k] = Number(v);
  saving.value = true;
  try {
    const out = await api(`/drafts/${id}/metrics`, { method: 'POST', body });
    history.value = out.history || [];
    toast(out.removed ? '已删掉这一天的记录' : '已记下', 'success');
  } catch (err) { toast(err.message); } finally { saving.value = false; }
}

async function del(h) {
  if (!(await confirm({ title: `删掉 ${h.capturedOn} 这次？`, ok: '删除', danger: true }))) return;
  try { history.value = (await api(`/drafts/${id}/metrics/${h.id}`, { method: 'DELETE' })).history || []; fill(); } catch (err) { toast(err.message); }
}
</script>

<style lang="scss" scoped>
.mf { padding-top: 20rpx; }
.mf-t { font-size: 32rpx; font-weight: 700; line-height: 1.5; }
.mf-s { display: flex; flex-wrap: wrap; gap: 12rpx; margin-top: 14rpx; }
.two { display: flex; gap: 20rpx; }
.two .field { flex: 1; }
.row { display: flex; align-items: center; }
.nums { display: flex; flex-wrap: wrap; gap: 20rpx; margin-bottom: 24rpx; }
.num { width: calc(50% - 10rpx); }
.label.sm { font-size: 24rpx; }
.hs { display: flex; align-items: center; gap: 16rpx; padding: 16rpx 0; border-top: 2rpx solid var(--border); font-size: 26rpx; }
.hs.on { color: var(--accent-ink); }
.mono { font-variant-numeric: tabular-nums; }
.del { color: var(--danger); font-size: 24rpx; }
.footer.row.gap { display: flex; gap: 20rpx; }
.footer .btn.lg:first-child { flex: none; padding: 0 32rpx; }
</style>
