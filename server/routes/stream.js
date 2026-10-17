/* 流式响应公共脚手架：开 SSE、断线 abort、出错推 error。
 * 业务只写 start / 调模型 / done；断线与收尾只修这一处。 */
import { streamText } from '../llm.js';
import { describe } from './common.js';

/**
 * @param {import('node:http').ServerResponse} res
 * @param {object} opts
 * @param {() => object | Promise<object>} [opts.start]  开流后立刻推的 start 载荷
 * @param {(send: Function) => Promise<void>|void} [opts.before]  start 之后、调模型之前（可推 progress）
 * @param {object} opts.stream  传给 streamText 的参数（meta/system/user/mock）；onDelta/signal 这里管
 * @param {(text: string, send: Function) => Promise<object|void>|object|void} [opts.after]
 *   流式写完后落盘等；返回值作为 done 事件的 data（可再拼）
 * @param {(err: Error, send: Function) => Promise<void>|void} [opts.onError]  额外清理（如恢复草稿）
 */
export async function runTextStream(res, opts) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  const controller = new AbortController();
  // 用 res 的 close 判断前端断开：req 的 close 在请求体读完时就已触发
  res.on('close', () => { if (!res.writableEnded) controller.abort(); });

  try {
    if (opts.start) send('start', await opts.start());
    if (opts.before) await opts.before(send);
    const text = await streamText({
      ...opts.stream,
      onDelta: (t) => send('delta', { text: t }),
      signal: controller.signal,
    });
    const done = opts.after ? await opts.after(text, send) : { text };
    if (done !== undefined) send('done', done ?? { text });
  } catch (err) {
    if (opts.onError) {
      try { await opts.onError(err, send); } catch (e) { console.error('[stream] onError', e?.message); }
    }
    if (!controller.signal.aborted) send('error', { message: describe(err) });
  } finally {
    res.end();
  }
}

/** 非流式长任务也复用同一套 SSE 头，推 progress / done / error */
export function openProgressStream(res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  const controller = new AbortController();
  res.on('close', () => { if (!res.writableEnded) controller.abort(); });
  return {
    send,
    get aborted() { return controller.signal.aborted; },
    signal: controller.signal,
    end() { if (!res.writableEnded) res.end(); },
  };
}
