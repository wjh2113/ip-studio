/* find / replace 改动的套用规则：服务端（语音改稿、按意见局部改、编辑器对话）和网页（对话里点「应用」）共用一份。
 * find 对不上正文的丢掉；同一句出现多次又没说全改的也丢掉，避免改错地方。 */
export function applyEdits(content, edits, max = 12) {
  let text = String(content || '');
  const applied = [];
  const skipped = [];
  for (const raw of (Array.isArray(edits) ? edits : []).slice(0, max)) {
    const find = String(raw?.find || '');
    const replace = String(raw?.replace ?? '');
    const all = Boolean(raw?.all);
    if (!find.trim()) {
      skipped.push('没有给出要改的原文');
      continue;
    }
    const count = text.split(find).length - 1;
    if (!count) {
      skipped.push(`找不到「${find.slice(0, 24)}」`);
      continue;
    }
    if (!all && count !== 1) {
      skipped.push(`「${find.slice(0, 24)}」有 ${count} 处，没有说明要全改`);
      continue;
    }
    text = all ? text.replaceAll(find, replace) : text.replace(find, replace);
    applied.push({ find: find.slice(0, 80), replace: replace.slice(0, 80), count: all ? count : 1 });
  }
  return { content: text, applied, skipped };
}
