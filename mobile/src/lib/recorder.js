/* 录音：App / 小程序用 uni 的录音管理器（mp3），H5 用浏览器 MediaRecorder（webm）。
 *   const rec = createRecorder(); await rec.start(); const { path, type, filename } = await rec.stop(); */

export function createRecorder() {
  // #ifdef H5
  let mr = null;
  let chunks = [];
  let stream = null;
  return {
    async start() {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      chunks = [];
      mr = new MediaRecorder(stream);
      mr.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      mr.start();
    },
    stop() {
      return new Promise((resolve) => {
        if (!mr) { resolve(null); return; }
        mr.onstop = () => {
          stream?.getTracks().forEach((t) => t.stop());
          const blob = new Blob(chunks, { type: mr.mimeType || 'audio/webm' });
          resolve({ path: URL.createObjectURL(blob), type: blob.type, filename: 'voice.webm' });
          mr = null;
        };
        mr.stop();
      });
    },
  };
  // #endif
  // #ifndef H5
  const rm = uni.getRecorderManager();
  let pending = null;
  rm.onStop((r) => { pending?.({ path: r.tempFilePath, type: 'audio/mpeg', filename: 'voice.mp3' }); pending = null; });
  rm.onError(() => { pending?.(null); pending = null; });
  return {
    start() {
      rm.start({ format: 'mp3', sampleRate: 16000, numberOfChannels: 1, duration: 120000 });
      return Promise.resolve();
    },
    stop() {
      return new Promise((resolve) => { pending = resolve; rm.stop(); });
    },
  };
  // #endif
}

/* 两段文字逐行比，返回中间改了的那一截：{ before: [...], after: [...] }。前后相同的行都去掉 */
export function changedSpan(oldText, newText) {
  const a = String(oldText || '').split('\n');
  const b = String(newText || '').split('\n');
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i += 1;
  let j = 0;
  while (j < a.length - i && j < b.length - i && a[a.length - 1 - j] === b[b.length - 1 - j]) j += 1;
  return { before: a.slice(i, a.length - j).filter((l) => l.trim()), after: b.slice(i, b.length - j).filter((l) => l.trim()) };
}
