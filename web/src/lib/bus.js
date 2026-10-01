/* 模块之间的「通知」：一个地方发生了事，别的地方各自决定要不要跟着动。
 * 要「调用」就直接调 store 的方法；只有发起方不该知道谁在听的时候才用这里。
 *
 * 现有事件（名字不带前缀，实际在 window 上是 cw-<名字>）：
 *   spent     花过点数（非 GET 请求成功、后台任务做完）→ 刷新余额
 *   quota     额度不够（402）→ 弹用量面板，detail: { message, quota }
 *   enter     登录后进了应用 → 要登录才能拉数据的模块开始工作
 *   job-done  后台任务做完，detail 是任务
 *
 * 用 window 事件而不是自己维护一份订阅表：浏览器自带，调试时在控制台也能直接监听。 */

export function emit(name, detail) {
  window.dispatchEvent(new CustomEvent(`cw-${name}`, { detail }));
}

/* 返回取消订阅的函数，组件卸载时调用 */
export function on(name, fn) {
  const handler = (e) => fn(e.detail);
  window.addEventListener(`cw-${name}`, handler);
  return () => window.removeEventListener(`cw-${name}`, handler);
}
