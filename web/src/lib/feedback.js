/* 给人的反馈：底部提示条 toast，和替代浏览器 confirm / prompt 的应用内对话框 ask。
 * 两者的界面在 components/common/Toast.vue、AskDialog.vue，挂在 App.vue 里；这里只放数据和调用入口，
 * 所以任何 store、组件都能直接 import 来用，不用层层传。
 *
 *   toast('已保存');
 *   if (!await ask.confirm({ title: '删掉？', danger: true, ok: '删除' })) return;
 *   const v = await ask.form({ title: '改名', fields: [{ key: 'name', label: '名字', required: true }] });  // 取消返回 null
 *
 * 不用原生 confirm：它顶着「localhost 显示」的标题、样式不受控、能被浏览器永久屏蔽，而且会卡住整个页面。 */
import { reactive } from 'vue';

export const toastState = reactive({ text: '', show: false });

let toastTimer = 0;

export function toast(message) {
  toastState.text = String(message ?? '');
  toastState.show = true;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastState.show = false; }, 2600);
}

/* 同一时刻只开一个对话框：两个叠在一起，键盘事件归谁就说不清了。新开的会把旧的当取消处理 */
export const askState = reactive({ open: null });

function open(opts, isForm) {
  if (askState.open) askState.open.resolve(isForm ? null : false);
  return new Promise((resolve) => {
    askState.open = {
      title: opts.title || '',
      body: opts.body || '',
      ok: opts.ok || '确定',
      cancel: opts.cancel || '取消',
      danger: Boolean(opts.danger),
      fields: isForm ? (opts.fields || []).map((f) => ({ ...f })) : null,
      resolve: (v) => { askState.open = null; resolve(v); },
    };
  });
}

export const ask = {
  confirm: (opts = {}) => open(opts, false),
  form: (opts = {}) => open(opts, true),
};
