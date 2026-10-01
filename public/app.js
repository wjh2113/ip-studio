/* 成稿区（第三步）还没迁到 Vue 的几个模块。页面由 Vue 3（web/src/main.js）挂载后加载本文件：
 *   core.js      共用：DOM 引用 el、状态 state，以及从 web/src/lib 转过来的 api、toast、文本小工具
 *   compose.js   选了方向之后的流式成稿；换稿子时成稿区各块的重置
 *   export.js    复制 / 下载 / 导出
 *   editor.js    成稿编辑器：保存、划词改写、/ 续写、AI 浮层、三动作工具条、正文历史、阅读/编辑模式、语音改稿
 *   review.js    成稿检查
 *   speak.js     口播提示、口播记录与评测、提词器
 *   versions.js  多平台版本与图文配图
 * 它们把需要被 Vue 那边调用的函数登记在 web/src/lib/legacy.js 里；启动（拉登录态、进应用）在 Vue 那边。 */
import './js/core.js';
import './js/compose.js';
import './js/export.js';
import './js/editor.js';
import './js/review.js';
import './js/speak.js';
import './js/versions.js';
