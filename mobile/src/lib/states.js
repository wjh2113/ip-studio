/* 内容日历的四种状态（服务端 /api/calendar、/api/today 返回的 states 里的值） */
export const STATES = {
  done: { label: '已成稿', color: '#16a34a' },
  cue: { label: '待口播', color: '#f59e0b' },
  published: { label: '已发布', color: '#2f6bff' },
  metrics: { label: '待回填', color: '#7c5cff' },
};
export const STATE_KEYS = Object.keys(STATES);

/* 按状态给主操作：待回填 → 回填，待口播 → 去录，其余 → 阅读 */
export function primaryAction(states = []) {
  if (states.includes('metrics')) return { label: '回填数据', page: 'metrics/fill' };
  if (states.includes('cue')) return { label: '去练口播', page: 'speak/record' };
  return { label: '阅读', page: 'create/draft' };
}
