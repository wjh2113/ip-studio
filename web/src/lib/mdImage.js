/* 整段只有 ![](/image/…) 时，换成真正的图片节点，编辑区才能看见图，复制也带得走 */
import { Extension } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';

const LINE = /^!\[([^\]]*)\]\((\/image\/\d+\/[\w.-]+)\)$/;

export const MdImage = Extension.create({
  name: 'mdImage',
  addProseMirrorPlugins() {
    return [new Plugin({
      appendTransaction(trs, _old, state) {
        if (!trs.some((tr) => tr.docChanged)) return null;
        const type = state.schema.nodes.image;
        if (!type) return null;
        const hits = [];
        state.doc.descendants((node, pos) => {
          if (node.type.name !== 'paragraph') return;
          const m = node.textContent.match(LINE);
          if (m) hits.push({ pos, size: node.nodeSize, alt: m[1], src: m[2] });
        });
        if (!hits.length) return null;
        let tr = state.tr;
        for (const h of hits.reverse()) {
          tr = tr.replaceWith(h.pos, h.pos + h.size, type.create({ src: h.src, alt: h.alt }));
        }
        return tr;
      },
    })];
  },
});
