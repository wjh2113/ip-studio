import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath } from 'node:url';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const API = process.env.CW_API || 'http://127.0.0.1:5177';

/* 样式、对话框、图标仍由 Node 从 public/ 提供，开发和构建后都走原地址。 */
const proxy = Object.fromEntries(
  ['/api', '/styles.css', '/dialog.js', '/mark.svg', '/image', '/speak', '/prompts', '/admin', '/start', '/about'].map((k) => [k, API]),
);

export default defineConfig({
  root: here('.'),
  plugins: [
    vue({
      template: {
        compilerOptions: {
          /* 保留原来 HTML 里的空白，避免行内元素被挤到一起 */
          whitespace: 'preserve',
        },
      },
    }),
  ],
  server: { port: 5180, strictPort: true, proxy },
  /* 构建产物单独放 dist/，每次先清空：不和手写的 public/ 混在一起，也不会留下一堆旧的带哈希文件。
     dist/ 不进 git（.gitignore），部署脚本在本机构建后同步到服务器。 */
  build: {
    outDir: here('../dist'),
    emptyOutDir: true,
    assetsDir: 'assets',
  },
});
