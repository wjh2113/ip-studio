/* TipTap 编辑器测试辅助：#editor 不再是 textarea，用 data-doc / _rich 桥 */

export async function editorDoc(page) {
  return page.$eval('#editor', (el) => el.dataset.doc ?? el._rich?.getDoc?.() ?? '');
}

export async function setEditorDoc(page, text) {
  await page.$eval('#editor', (el, t) => {
    if (el._rich?.setDoc) el._rich.setDoc(t);
  }, text);
  await page.waitForFunction((t) => {
    const el = document.querySelector('#editor');
    return (el?.dataset?.doc ?? el?._rich?.getDoc?.() ?? '') === t;
  }, text, { timeout: 5000 });
}

export async function selectEditor(page, start, end) {
  await page.$eval('#editor', (el, [a, b]) => {
    el._rich?.focus?.();
    el._rich?.setSelection?.(a, b ?? a);
  }, [start, end]);
  // 等划词菜单有机会弹出
  await page.waitForTimeout(50);
}
