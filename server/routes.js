/* API 处理函数的聚合入口。实现按业务域拆在 server/routes/ 下：
 *   common.js     各业务路由共用的小工具：JSON 响应、登录校验、错误文案、重试、账号与语气样本解析
 *   auth.js       注册、登录、登出、当前用户与站点元信息
 *   prompts.js    提示词说明书：读取、编辑（仅管理员）、切换版本
 *   admin.js      管理后台：登录与首次设置、用量概览、提示词目录、运行时配置、A/B 变体与 eval
 *   personas.js   账号设定、内容栏目、语气样本与语气档案
 *   hotspots.js   热点榜单、按账号比对热点、题材推荐
 *   drafts.js     创作主流程：三个方向、流式成稿、保存与历史版本、列表、归档、删除
 *   review.js     成稿检查：语言错误 + 调性与风险两层
 *   speak.js      口播提示、口播录音留档与评测
 *   editor.js     编辑器：划词改写、/ 续写、语音改稿
 *   publish.js    多平台版本、图文配图、Word 导出
 *   materials.js  素材库与选题池
 *   insights.js   发布数据回填与复盘
 *   billing.js    套餐、额度、下单与支付回调
 *   frameworks.js 框架库：内置与我的、推荐、增删改
 *   jobs.js       任务中心
 *   mobile.js     手机 App：今天、内容日历与标记发布、离线收件箱、发布包
 *   benchmarks.js 对标速存：抓网页 / 粘贴文本拆提纲，转存素材或框架
 *   export.js     同步密钥与成稿导出（Obsidian 插件）
 * index.js 和测试仍然从这里 import，不用关心函数具体在哪个文件。 */
export * from './routes/common.js';
export * from './routes/auth.js';
export * from './routes/prompts.js';
export * from './routes/admin.js';
export * from './routes/personas.js';
export * from './routes/hotspots.js';
export * from './routes/drafts.js';
export * from './routes/review.js';
export * from './routes/speak.js';
export * from './routes/editor.js';
export * from './routes/publish.js';
export * from './routes/materials.js';
export * from './routes/insights.js';
export * from './routes/billing.js';
export * from './routes/frameworks.js';
export * from './routes/jobs.js';
export * from './routes/mobile.js';
export * from './routes/benchmarks.js';
export * from './routes/export.js';
