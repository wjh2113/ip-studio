import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath } from 'node:url';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const API = process.env.CW_API || 'http://127.0.0.1:5177';

/* 六个页面，各自一个入口：
 *   index.html    应用（/、/app）
 *   admin.html    管理后台（/admin）
 *   prompts.html  提示词说明书（/prompts，仅 APP_ADMINS / 后台管理员）
 *   guide.html    使用说明（/guide，登录用户）
 *   landing.html  落地页（/about；未登录访问 / 也是它）
 *   promo.html    营销页（/start，投放链接指这里）
 * 线上由 Node 按这些地址从 dist/ 出页面（server/index.js 的 serveStatic）；开发时下面的插件做同样的映射。 */
const PAGES = { '/admin': '/admin.html', '/prompts': '/prompts.html', '/guide': '/guide.html', '/about': '/landing.html', '/start': '/promo.html' };

const pageRoutes = {
  name: 'page-routes',
  configureServer(server) {
    server.middlewares.use((req, _res, next) => {
      const [path, query = ''] = req.url.split('?');
      const page = PAGES[path.replace(/\/$/, '')];
      if (page) req.url = page + (query ? `?${query}` : '');
      next();
    });
  },
};

/* 接口和用户自己的媒体文件（配图、录音）在 Node 那边 */
const proxy = Object.fromEntries(['/api', '/image', '/speak'].map((k) => [k, API]));

export default defineConfig({
  root: here('.'),
  plugins: [
    pageRoutes,
    vue({
      template: {
        compilerOptions: {
          /* 保留模板里的空白，避免行内元素被挤到一起（样式是按原来的 HTML 写的） */
          whitespace: 'preserve',
        },
      },
    }),
  ],
  server: { port: 5180, strictPort: true, proxy },
  /* 构建产物单独放 dist/，每次先清空，也不会留下一堆旧的带哈希文件。
     dist/ 不进 git（.gitignore），部署脚本在本机构建后同步到服务器。web/public/ 里的文件（图标）原样拷到 dist/ 根目录。 */
  build: {
    outDir: here('../dist'),
    emptyOutDir: true,
    assetsDir: 'assets',
    rollupOptions: {
      input: {
        index: here('index.html'),
        admin: here('admin.html'),
        prompts: here('prompts.html'),
        guide: here('guide.html'),
        landing: here('landing.html'),
        promo: here('promo.html'),
      },
    },
  },
});
