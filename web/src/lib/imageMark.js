/* TipTap 原子节点：正文里的「此处放图片」占位，序列化回 IMAGE_MARK 字面量 */
import { Node, mergeAttributes } from '@tiptap/core';
import { IMAGE_MARK } from '../../../shared/place.js';

export const ImageMark = Node.create({
  name: 'imageMark',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  parseHTML() {
    return [{ tag: 'div[data-image-mark]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-image-mark': '', class: 'image-mark-node' }), IMAGE_MARK];
  },

  addCommands() {
    return {
      insertImageMark: () => ({ commands }) => commands.insertContent({ type: this.name }),
    };
  },
});

export { IMAGE_MARK };
