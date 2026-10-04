/* uni-app 的 Vite 配置。H5 调试时把 /api 和 /image 代理到本地服务端（npm run dev，默认 5177），
 * App 里没有同源，地址走 VITE_API_BASE（见 src/config.js）。 */
import { defineConfig, loadEnv } from 'vite';
import uniPlugin from '@dcloudio/vite-plugin-uni';

// Node 原生 ESM 加载 CJS 模块时不认 __esModule，default 拿到的是整个 module.exports；
// 真正的插件函数在 .default 上。两种情况都兜住。
const uni = uniPlugin.default || uniPlugin;

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const target = env.VITE_DEV_SERVER || 'http://127.0.0.1:5177';
  return {
    plugins: [uni()],
    server: {
      proxy: {
        '/api': { target, changeOrigin: true },
        '/image': { target, changeOrigin: true },
      },
    },
  };
});
