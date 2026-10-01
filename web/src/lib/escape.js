/* Esc 关浮层：几层叠着开的时候，只关最上面（最后打开）那一层。
 *
 *   const esc = escStack(() => isOpen, close);
 *   watch(isOpen, (v) => esc.toggle(v));      // 打开时入栈，关上时出栈
 *
 * 应用内对话框（ask）在捕获阶段自己处理 Esc 并拦下，不经过这里。 */

const stack = [];

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || !stack.length) return;
  const top = stack[stack.length - 1];
  if (!top.isOpen()) return;
  e.preventDefault();
  top.close();
});

export function escStack(isOpen, close) {
  const entry = { isOpen, close };
  return {
    toggle(on) {
      const i = stack.indexOf(entry);
      if (i >= 0) stack.splice(i, 1);
      if (on) stack.push(entry);
    },
  };
}

/* 栈里有没有开着的浮层：编辑器的划词菜单之类在浮层开着时不该响应 Esc */
export const anyLayerOpen = () => stack.some((x) => x.isOpen());
