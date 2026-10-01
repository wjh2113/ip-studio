# 自媒体助手 App（mobile/）

uni-app（Vue 3 + Pinia）的 Vite 命令行工程，一套代码出 **H5、安卓 / iOS App、微信小程序**。
定位是「随身」：看今天该干嘛、路上记灵感、对着提词器录口播、到点把成稿复制出去发。长文精细编辑、框架库、管理后台仍在网页上做。

和网页共用同一个服务端（`server/`），接口说明见 [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md) 的「移动端接口」。

## 跑起来

```bash
cd mobile
npm install                # 依赖只装在 mobile/ 里，和根目录的 package.json 互不影响
cp .env.example .env       # App 打包前填 VITE_API_BASE；H5 调试可以不填

# 另开一个终端，在仓库根目录起服务端：npm run dev（默认 5177）
npm run dev:h5             # 浏览器里调试，/api 和 /image 由 vite 代理到 VITE_DEV_SERVER
npm run dev:app            # 生成 App 资源，用 HBuilderX 打开 mobile/ 真机运行 / 云打包
npm run dev:mp-weixin      # 生成 dist/dev/mp-weixin，用微信开发者工具打开
npm run build:h5 | build:app | build:mp-weixin
```

- App 打包要在 `src/manifest.json` 里填 `appid`（DCloud 后台申请），并把服务端域名配进 `VITE_API_BASE`（必须 https）。
- 小程序还要在微信公众平台把服务端域名加进「request 合法域名」和「uploadFile 合法域名」，`manifest.json` 的 `mp-weixin.appid` 填自己的。
- H5 可以和网页同源部署（`VITE_API_BASE` 留空），也可以单独部署。

## 登录方式

App 和小程序没有 cookie，登录时带请求头 `X-Client: app`，服务端在回包里多给一个 `token`，存在本机（`uni.setStorageSync('cw_token')`），
之后每个请求带 `Authorization: Bearer <token>`。服务端回 401 时清掉 token、回登录页。退出登录会删掉服务端那条会话。

## 页面

底部五个标签：**今天 / 创作 / 口播 / 灵感 / 我的**。

| 页面 | 路径 | 做什么 |
|---|---|---|
| 今天 | `pages/today` | 待办（待回填数据、在跑的任务、选题池）、今日可发、口播未练、额度、本周日历；顶部一键切账号 |
| 登录 | `pages/login` | 登录 / 注册 |
| 创作 | `pages/create/index` → `topics` → `draft` | 快速出稿：题材 → 三个方向 → 成稿（流式），可从选题池选题 |
| 发布包 | `pages/create/package` | 按平台给标题、纯文本正文、话题标签、配图，分别复制或一次复制全部；标题超长会提示去「标题候选」 |
| 标题候选 | `pages/create/titles` | 出一批标题，选一个写进发布包 |
| 语音改稿 | `pages/create/voice` | 按住说「第二段改短点」，整篇或选中段落改 |
| 审稿卡片 | `pages/create/review` | 成稿检查的问题一条一张卡，左右滑：知道了 / 稍后 / 跳过 |
| 配图 | `pages/create/illus` | 出图、看图、保存到相册 |
| 口播 | `pages/speak/index` | 待练口播、评测记录 |
| 录制 | `pages/speak/record` | 录前试镜（前置摄像头、光线和音量）、场景预设（室外 / 车上 / 室内）、提词器录制、防息屏 |
| 评测结果 | `pages/speak/result` | 总分、逐句问题，点一句跳到提词器对应位置重录 |
| 灵感 | `pages/inspire/index` | 语音记 / 打字记 / 拍照记 / 剪贴板导入；显示每条是否已同步 |
| 记一条 | `pages/inspire/edit` | 存到选题池或素材库，关联账号；没网先存本机 |
| 对标速存 | `pages/inspire/benchmark` | 贴链接或正文，只存标题、提纲和摘要；可转成素材或写法框架 |
| 任务 | `pages/jobs` | 出图、口播评测这些后台任务：进行中 / 已完成 / 失败，取消、重试、看结果 |
| 回填数据 | `pages/metrics/fill` | 发布后第 1、7 天填阅读、点赞等 |
| 复盘 | `pages/metrics/insights` | 只读：按方向类型、栏目、平台分组看 |
| 内容日历 | `pages/calendar` | 周视图，标记 / 取消已发布 |
| 快速建号 | `pages/account/quick` | 贴一段自我介绍（可语音），帮你填好账号设定 |
| 喂语气样本 | `pages/account/feed` | 粘贴以前写的文章，加进语气样本并重建档案 |
| 我的 | `pages/me/index` | 账号、额度、入口、设置（提词器默认场景、防息屏、提醒开关） |
| 用量与套餐 | `pages/me/plan` | 只看额度和套餐；买套餐去网页 |

## 代码结构

```
src/
  App.vue          全局样式（设计令牌、按钮、卡片、标签这些通用类）、启动、分享进来的内容
  pages.json       页面与底部标签；manifest.json 应用名、权限与隐私说明
  config.js        服务端地址
  lib/
    api.js         请求封装（Bearer、401 回登录、流式 SSE、上传录音 / 图片、带 token 的图片地址）
    ui.js          提示、确认框、动作菜单、跳页
    text.js        Markdown 渲染、分段、日期工具
    recorder.js    录音（三端统一接口）；capture.js 摄像头录像与防息屏
    image.js       带 token 的图片、存相册、去系统设置开权限
    takes.js       没网时录好的口播先存本机；later.js 审稿「稍后」的卡片；states.js 日历状态
  stores/          session 登录态 · account 账号与切换 · jobs 任务 · prefs 本机设置 · inbox 离线收件箱 · create 出稿表单
  components/      Ic 图标 · TopBar 账号切换 · Sheet 底部抽屉 · StepBar 步骤条
  static/          标签图标、品牌图
```

写代码的约定：

- 页面和组件的样式一律 `scoped`，通用类只放 `App.vue`（以前不加 scoped，各页同名类互相覆盖过）。
- 尺寸用 `rpx`；固定在底部的按钮条用 `bottom: var(--window-bottom)`，H5 的标签栏才不会盖住它。
- **setup 里的变量名不要和 uni 组件同名**（`text`、`view`、`input`、`image`、`button`…）：模板里的 `<text>` 会被解析成这个变量，整页出不来。`node scripts/check.js` 会拦。
- 平台差异用条件编译 `// #ifdef H5` / `APP-PLUS` / `MP-WEIXIN`。`scripts/check.js` 会把每个文件按 H5、App、小程序三种展开后分别检查语法。

## 离线

- **灵感**：记下的先进本机队列（`stores/inbox.js`），有网就批量传 `/api/inbox`。每条带随机 `key`，服务端按 key 去重，重传不会记两遍。图片压缩后以 data URL 一起存，单张超过 2.5MB 不收。
- **口播录音**：没网时录完先存本机（`lib/takes.js`），口播页会提示重新上传。
- 其他页面需要联网。

## 第一版没做的

- **App 里录口播只录声音**：提词器边滚动边录视频要用 nvue 的 `live-pusher` 或原生插件，第一版 App 端先录音频；H5（getUserMedia）和小程序（`camera` 组件）可以录视频。
- **从别的 App「分享到」自媒体助手**：要安卓的 `ACTION_SEND` intent-filter 和 iOS 的 Share Extension，需要原生配置后云打包。现在 `App.vue` 已经能读 `plus.runtime.arguments` 里带进来的文字 / 链接，配好以后直接能用；在那之前用「从剪贴板导入」。
- **推送**：提醒先显示在「今天」页（待回填、任务失败、额度不足）。「我的 → 设置」里的提醒开关已经存在本机，接 uni-push 后按这些开关发。
- **买套餐**：在网页「用量与套餐」里操作，手机上只看额度。（应用商店对虚拟商品内购有要求，上架前要先定方案。）
- **日期**：服务端按 UTC 算「今天」和回填天数，App 显示用本机时区。北京时间早上 8 点前两边会差一天，回填提醒可能晚几个小时出现。

## 上架前要确认

面向公众提供生成式 AI 服务需要算法备案 / 大模型备案，App 还要软件著作权、ICP 备案和隐私合规检测（权限说明已写在 `manifest.json`）；小程序类目里「AI 生成内容」要单独资质。立项上架前先确认。
