/* 编辑框里把已出的配图画出来。图存在稿子的配图方案里，不写进正文；
 * 阅读区用 weave 插进 HTML，编辑区用装饰画在同一位置，避免一保存就把图写进 Markdown。 */
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { placeCuts } from '../../../shared/place.js';
import { serializeEditor } from './richdoc.js';
import { imageUrl } from '../stores/versions.js';

function figure(item) {
  const fig = document.createElement('figure');
  fig.className = 'illus-widget';
  fig.contentEditable = 'false';
  const img = document.createElement('img');
  img.className = 'doc-img';
  img.src = imageUrl(item.image);
  img.alt = item.alt || '';
  fig.appendChild(img);
  if (item.alt) {
    const cap = document.createElement('figcaption');
    cap.textContent = item.alt;
    fig.appendChild(cap);
  }
  return fig;
}

export function illusDecorations(editor, items) {
  const list = (items || []).filter((it) => it?.image?.file);
  if (!editor || !list.length) return DecorationSet.empty;
  const { text, docToPm } = serializeEditor(editor);
  const cuts = placeCuts(text, list).filter((c) => c.item?.image?.file);
  if (!cuts.length) return DecorationSet.empty;
  const { doc } = editor.state;
  const decos = [];
  for (const c of cuts) {
    const widget = () => figure(c.item);
    if (c.skip) {
      const pos = docToPm(c.at);
      const node = doc.nodeAt(pos);
      if (node?.type.name === 'imageMark') {
        decos.push(Decoration.node(pos, pos + node.nodeSize, { class: 'illus-filled' }));
        decos.push(Decoration.widget(pos + node.nodeSize, widget, { side: -1 }));
        continue;
      }
    }
    const pos = c.at >= text.length ? doc.content.size : docToPm(c.at);
    decos.push(Decoration.widget(pos, widget, { side: 1 }));
  }
  return DecorationSet.create(doc, decos);
}

export const IllusDecor = Extension.create({
  name: 'illusDecor',
  addStorage() {
    return { items: [], editor: null };
  },
  addProseMirrorPlugins() {
    const storage = this.storage;
    return [new Plugin({
      key: new PluginKey('illusDecor'),
      props: {
        decorations() {
          return illusDecorations(storage.editor, storage.items);
        },
      },
    })];
  },
});
