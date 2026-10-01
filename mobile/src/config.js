/* 服务端地址。H5 和网页同源部署时留空（走相对路径）；App 里没有同源，打包前在 .env 里配 VITE_API_BASE。 */
export const API_BASE = (import.meta.env.VITE_API_BASE || '').replace(/\/$/, '');
