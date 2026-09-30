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
  build: {
    outDir: here('../public'),
    emptyOutDir: false,
    assetsDir: 'assets',
  },
});
