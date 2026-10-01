/* 录口播：前置摄像头 + 麦克风。三端能力不一样，统一成 start / stop：
 *   H5      getUserMedia 拿前置摄像头和麦克风，MediaRecorder 录 webm 视频（预览挂在页面给的容器里）
 *   小程序   <camera> 组件 + CameraContext 录视频（页面里放 camera 组件）
 *   App      第一阶段只录声音（提词照常滚动）；要带画面，用系统相机录好再上传——
 *            边看提词边录像需要 nvue 的 live-pusher 或原生插件，放到下一阶段 */

export function captureMode() {
  // #ifdef H5
  return 'video';
  // #endif
  // #ifdef MP-WEIXIN
  return 'video';
  // #endif
  // #ifdef APP-PLUS
  return 'audio';
  // #endif
}

export function createCapture() {
  // #ifdef H5
  let stream = null;
  let mr = null;
  let chunks = [];
  let videoEl = null;
  let audioCtx = null;
  let analyser = null;
  return {
    /* 打开摄像头，预览挂到 host（一个 DOM 元素）里 */
    async open(host) {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 720, height: 1280 }, audio: true });
      videoEl = document.createElement('video');
      Object.assign(videoEl, { muted: true, playsInline: true, autoplay: true });
      videoEl.setAttribute('playsinline', '');
      videoEl.style.cssText = 'width:100%;height:100%;object-fit:cover;transform:scaleX(-1)';
      videoEl.srcObject = stream;
      host?.appendChild(videoEl);
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 512;
      audioCtx.createMediaStreamSource(stream).connect(analyser);
    },
    /* 0~1 的音量和画面亮度：试镜时给「过暗/逆光/OK」「音量」提示 */
    sample() {
      let level = 0;
      if (analyser) {
        const buf = new Uint8Array(analyser.fftSize);
        analyser.getByteTimeDomainData(buf);
        let sum = 0;
        for (const v of buf) sum += ((v - 128) / 128) ** 2;
        level = Math.min(1, Math.sqrt(sum / buf.length) * 4);
      }
      let light = null;
      let backlit = false;
      if (videoEl?.videoWidth) {
        const c = document.createElement('canvas');
        c.width = 36; c.height = 64;
        const g = c.getContext('2d');
        g.drawImage(videoEl, 0, 0, 36, 64);
        const px = g.getImageData(0, 0, 36, 64).data;
        let all = 0; let mid = 0; let edge = 0; let nm = 0; let ne = 0;
        for (let y = 0; y < 64; y += 1) for (let x = 0; x < 36; x += 1) {
          const i = (y * 36 + x) * 4;
          const l = (px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114) / 255;
          all += l;
          if (x > 9 && x < 27 && y > 14 && y < 40) { mid += l; nm += 1; } else { edge += l; ne += 1; }
        }
        light = all / (36 * 64);
        backlit = edge / ne - mid / nm > 0.18;     // 四周比脸亮得多：逆光
      }
      return { level, light, backlit };
    },
    start() {
      chunks = [];
      const type = MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus') ? 'video/webm;codecs=vp8,opus' : 'video/webm';
      mr = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 1200000 });
      mr.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      mr.start(1000);
    },
    stop() {
      return new Promise((resolve) => {
        if (!mr) { resolve(null); return; }
        mr.onstop = () => {
          const blob = new Blob(chunks, { type: 'video/webm' });
          resolve({ path: URL.createObjectURL(blob), type: 'video/webm', filename: 'take.webm', size: blob.size });
          mr = null;
        };
        mr.stop();
      });
    },
    close() {
      stream?.getTracks().forEach((t) => t.stop());
      audioCtx?.close();
      videoEl?.remove();
      stream = null;
    },
  };
  // #endif
  // #ifdef MP-WEIXIN
  let ctx = null;
  return {
    async open() { ctx = uni.createCameraContext(); },
    sample() { return { level: null, light: null, backlit: false }; },
    start() { ctx.startRecord({ timeout: 300 }); },
    stop() {
      return new Promise((resolve) => {
        ctx.stopRecord({ compressed: true, success: (r) => resolve({ path: r.tempVideoPath, type: 'video/mp4', filename: 'take.mp4' }), fail: () => resolve(null) });
      });
    },
    close() {},
  };
  // #endif
  // #ifdef APP-PLUS
  const rm = uni.getRecorderManager();
  let pending = null;
  let level = 0;
  rm.onStop((r) => { pending?.({ path: r.tempFilePath, type: 'audio/mpeg', filename: 'take.mp3' }); pending = null; });
  rm.onFrameRecorded?.((r) => {
    // 用帧大小粗略估音量：够画一条电平
    level = Math.min(1, (r.frameBuffer?.byteLength || 0) / 4000);
  });
  return {
    async open() {},
    sample() { return { level, light: null, backlit: false }; },
    start() { rm.start({ format: 'mp3', sampleRate: 44100, numberOfChannels: 1, duration: 600000, frameSize: 4 }); },
    stop() { return new Promise((resolve) => { pending = resolve; rm.stop(); }); },
    close() {},
  };
  // #endif
}

/* 防息屏：录的时候屏幕不能灭 */
let wakeLock = null;
export async function keepAwake(on) {
  // #ifdef H5
  try {
    if (on && navigator.wakeLock) wakeLock = await navigator.wakeLock.request('screen');
    if (!on) { await wakeLock?.release(); wakeLock = null; }
  } catch { /* 浏览器不支持就算了 */ }
  // #endif
  // #ifndef H5
  uni.setKeepScreenOn({ keepScreenOn: Boolean(on) });
  // #endif
}
