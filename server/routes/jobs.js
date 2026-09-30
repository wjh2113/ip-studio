/* 路由 · jobs：任务中心。出图、口播转写与总评、语音/视频测评都在任务队列里跑，这里查进度、取消、重试。 */
import { Jobs } from '../db.js';
import { HttpError } from '../auth.js';
import { ACTIVE, presentJob, retry } from '../jobs.js';
import { json, requireUser } from './common.js';

const mine = (req, params) => {
  const user = requireUser(req);
  const job = Jobs.byId(Number(params.jid), user.id);
  if (!job) throw new HttpError(404, '这个任务不存在');
  return { user, job };
};

/* 最近 30 条，前端据此显示进行中的数量和任务中心列表 */
export async function handleJobList(req, res) {
  const user = requireUser(req);
  const jobs = Jobs.list(user.id, 30).map(presentJob);
  json(res, 200, { jobs, active: jobs.filter((j) => ACTIVE.has(j.status)).length });
}

export async function handleJobGet(req, res, body, params) {
  const { job } = mine(req, params);
  json(res, 200, { job: presentJob(job) });
}

/* 只能取消还在排队的；已经在跑的（钱可能已经花出去了）让它跑完 */
export async function handleJobCancel(req, res, body, params) {
  const { user, job } = mine(req, params);
  if (job.status === 'running') throw new HttpError(409, '已经开始做了，取消不了，等它做完');
  if (!Jobs.cancel(job.id, user.id)) throw new HttpError(409, '这个任务已经结束了');
  json(res, 200, { job: presentJob(Jobs.byId(job.id, user.id)) });
}

export async function handleJobRetry(req, res, body, params) {
  const { job } = mine(req, params);
  if (ACTIVE.has(job.status)) throw new HttpError(409, '这个任务还没结束');
  if (job.status === 'done') throw new HttpError(409, '这个任务已经做完了');
  json(res, 202, { job: presentJob(retry(job)) });
}
