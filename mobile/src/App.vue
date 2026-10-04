<script setup>
/* 应用壳：冷启动拉登录态；没登录去登录页。全局监听登录过期、离线队列、任务完成 */
import { onLaunch, onShow } from '@dcloudio/uni-app';
import { useSessionStore } from './stores/session.js';
import { useAccountStore } from './stores/account.js';
import { useInboxStore } from './stores/inbox.js';
import { useJobsStore } from './stores/jobs.js';
import { toast } from './lib/ui.js';

onLaunch(async () => {
  const session = useSessionStore();
  const inbox = useInboxStore();
  inbox.watchNetwork();
  uni.$on('auth-expired', () => {
    session.user = null;
    uni.reLaunch({ url: '/pages/login/index' });
  });
  uni.$on('job-done', (j) => {
    toast(j.status === 'done' ? `${j.label || '任务'}好了` : `${j.label || '任务'}失败了，去任务里重试`);
  });
  const user = await session.boot();
  if (!user) { uni.reLaunch({ url: '/pages/login/index' }); return; }
  await useAccountStore().load().catch(() => {});
  useJobsStore().load();
});

onShow(() => {
  // 回到前台：交离线攒下的灵感、刷新任务
  const session = useSessionStore();
  if (!session.user) return;
  useInboxStore().flush();
  useJobsStore().load();
  // #ifdef APP-PLUS
  // 从别的 App 分享进来（文字、链接）：直接打开「记一条」，内容带上。
  // 安卓要在原生清单里给 ACTION_SEND 配 intent-filter，iOS 要分享扩展——见 mobile/README.md
  const arg = String(plus.runtime.arguments || '').trim();
  if (arg && !/^\{/.test(arg)) {
    plus.runtime.arguments = '';
    uni.navigateTo({ url: `/pages/inspire/quick?text=${encodeURIComponent(arg.slice(0, 2000))}` });
  }
  // #endif
});
</script>

<style lang="scss">
/* 设计令牌：和网页端 base.css 同一套颜色。单位用 rpx（750 = 屏宽） */
page {
  --bg: #f4f6fa;
  --panel: #ffffff;
  --panel-2: #f7f9fc;
  --border: #e4e8ef;
  --line-strong: #d3d9e3;
  --text: #1b2232;
  --muted: #667085;
  --faint: #98a2b3;
  --accent: #2f6bff;
  --accent-ink: #1f56e0;
  --accent-soft: #eef3ff;
  --accent-line: #cfdcff;
  --ok: #16a34a;
  --ok-soft: #e9f8ef;
  --warn: #c76a00;
  --warn-soft: #fff5e5;
  --danger: #e5484d;
  --danger-soft: #fdeeee;
  --violet: #7c5cff;
  --violet-soft: #f1edff;
  --teal: #12b886;
  --teal-soft: #e6f8f1;
  background: var(--bg);
  color: var(--text);
  font-size: 28rpx;
  line-height: 1.6;
  font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans SC", sans-serif;
}

view, text, scroll-view, input, textarea, button { box-sizing: border-box; }

/* ---------- 通用块 ---------- */
.wrap { padding: 0 28rpx; }
.card { background: var(--panel); border-radius: 24rpx; padding: 28rpx; margin: 0 28rpx 24rpx; }
.card-h { display: flex; align-items: center; margin-bottom: 20rpx; }
.card-t { font-size: 32rpx; font-weight: 600; }
.card-sub { font-size: 24rpx; color: var(--faint); margin-left: 12rpx; }
.grow { flex: 1; }
.more { font-size: 24rpx; color: var(--muted); display: flex; align-items: center; }
.muted { color: var(--muted); }
.faint { color: var(--faint); }
.hint { font-size: 24rpx; color: var(--muted); line-height: 1.6; }
.row { display: flex; align-items: center; }
.ellipsis { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* ---------- 按钮 ---------- */
.btn {
  display: flex; align-items: center; justify-content: center; gap: 10rpx;
  height: 80rpx; padding: 0 32rpx; border-radius: 16rpx;
  background: var(--panel); color: var(--text); border: 2rpx solid var(--border);
  font-size: 28rpx; font-weight: 500; line-height: 1;
}
.btn::after { border: 0; }
.btn.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
.btn.soft { background: var(--accent-soft); border-color: transparent; color: var(--accent-ink); }
.btn.danger { color: var(--danger); border-color: #f4c7c9; background: transparent; }
.btn.small { height: 60rpx; padding: 0 22rpx; font-size: 24rpx; border-radius: 12rpx; }
.btn.lg { height: 96rpx; font-size: 32rpx; border-radius: 20rpx; }
.btn.block { width: 100%; }
.btn[disabled], .btn.disabled { opacity: .5; }

/* ---------- 芯片 / 标签 ---------- */
.chip { display: inline-flex; align-items: center; gap: 6rpx; white-space: nowrap; flex: none; padding: 4rpx 14rpx; border-radius: 8rpx; font-size: 22rpx; background: var(--accent-soft); color: var(--accent-ink); }
.chip.ok { background: var(--ok-soft); color: var(--ok); }
.chip.warn { background: var(--warn-soft); color: var(--warn); }
.chip.bad { background: var(--danger-soft); color: var(--danger); }
.chip.gray { background: var(--panel-2); color: var(--muted); }
.chip.violet { background: var(--violet-soft); color: #6142e6; }
.chip.teal { background: var(--teal-soft); color: #0c8a63; }

/* ---------- 表单 ---------- */
.field { margin-bottom: 28rpx; }
.label { font-size: 26rpx; font-weight: 600; margin-bottom: 12rpx; display: flex; align-items: center; gap: 8rpx; }
.label .opt { font-weight: 400; color: var(--faint); font-size: 24rpx; }
.input, .area {
  width: 100%; background: var(--panel-2); border: 2rpx solid var(--border); border-radius: 16rpx;
  padding: 20rpx 24rpx; font-size: 28rpx; color: var(--text);
}
.input { height: 84rpx; }
.area { min-height: 180rpx; line-height: 1.6; }
.ph { color: var(--faint); }

/* 分段选择 */
.seg { display: flex; background: var(--panel-2); border-radius: 16rpx; padding: 6rpx; }
.seg-i { flex: 1; text-align: center; font-size: 26rpx; color: var(--muted); padding: 14rpx 0; border-radius: 12rpx; }
.seg-i.on { background: var(--panel); color: var(--accent-ink); font-weight: 600; box-shadow: 0 2rpx 6rpx rgba(16, 24, 40, .08); }

/* 选项块（栏目、框架） */
.picks { display: flex; flex-wrap: wrap; gap: 16rpx; }
.pick { padding: 14rpx 26rpx; border-radius: 12rpx; background: var(--panel-2); border: 2rpx solid var(--border); font-size: 26rpx; color: var(--text); }
.pick.on { background: var(--accent-soft); border-color: var(--accent); color: var(--accent-ink); font-weight: 600; }

/* 底部固定操作区（安全区） */
.footer {
  /* H5 的 tabBar 是页面里画的，--window-bottom 让出它的高度；App 里 tabBar 在页面外，这个值是 0 */
  position: fixed; left: 0; right: 0; bottom: var(--window-bottom, 0); z-index: 20;
  padding: 20rpx 28rpx calc(20rpx + env(safe-area-inset-bottom));
  background: rgba(255, 255, 255, .96); border-top: 2rpx solid var(--border);
}
.footer-pad { height: calc(160rpx + env(safe-area-inset-bottom)); }

/* 空状态 */
.empty { display: flex; flex-direction: column; align-items: center; padding: 60rpx 40rpx; text-align: center; color: var(--muted); font-size: 26rpx; line-height: 1.8; }
.empty .ic-big { width: 96rpx; height: 96rpx; margin: 0 auto 16rpx; opacity: .5; }

/* 骨架屏 */
.skel { background: linear-gradient(90deg, #eef1f6 25%, #f7f9fc 50%, #eef1f6 75%); background-size: 400% 100%; animation: skel 1.2s linear infinite; border-radius: 16rpx; }
@keyframes skel { 0% { background-position: 100% 0; } 100% { background-position: 0 0; } }

/* 账号头像、顶栏的圆角按钮：顶栏、我的页、切换器都用 */
.avatar {
  width: 72rpx; height: 72rpx; border-radius: 50%; flex: none;
  display: flex; align-items: center; justify-content: center;
  color: #fff; font-weight: 600; font-size: 30rpx;
  background: linear-gradient(135deg, #6f9bff, #2f6bff);
}
.avatar.sm { width: 64rpx; height: 64rpx; font-size: 26rpx; }
.avatar[data-tone="1"] { background: linear-gradient(135deg, #58c4a6, #1f9d7a); }
.avatar[data-tone="2"] { background: linear-gradient(135deg, #f7a35c, #e5772e); }
.avatar[data-tone="3"] { background: linear-gradient(135deg, #9b8cf5, #6a5ae0); }
.avatar[data-tone="4"] { background: linear-gradient(135deg, #5d6b82, #3a4558); }
.avatar.all { background: var(--panel-2); border: 2rpx dashed var(--line-strong); }
.tasks {
  position: relative; display: flex; align-items: center; gap: 8rpx;
  height: 68rpx; padding: 0 24rpx; border-radius: 34rpx; background: var(--panel);
  font-size: 26rpx; font-weight: 500; box-shadow: 0 2rpx 8rpx rgba(16, 24, 40, .06);
}
.badge {
  position: absolute; top: -10rpx; right: -6rpx; min-width: 32rpx; height: 32rpx; padding: 0 8rpx;
  border-radius: 16rpx; background: #f04438; color: #fff; font-size: 20rpx; line-height: 32rpx; text-align: center;
}

/* 正文阅读（rich-text 里的 class） */
.md-p { margin: 0 0 28rpx; }
.md-h2 { font-size: 36rpx; font-weight: 700; margin: 40rpx 0 18rpx; }
.md-h3 { font-size: 32rpx; font-weight: 700; margin: 32rpx 0 14rpx; }
.md-h4 { font-size: 30rpx; font-weight: 600; margin: 24rpx 0 10rpx; }
.md-ul, .md-ol { padding-left: 40rpx; margin: 0 0 24rpx; }
.md-li { margin-bottom: 10rpx; }
.md-hr { border: 0; border-top: 2rpx solid var(--border); margin: 36rpx 0; }
.md-on { background: #fff4c2; border-radius: 8rpx; }
.stress { font-weight: 700; color: #ffd479; }
</style>
