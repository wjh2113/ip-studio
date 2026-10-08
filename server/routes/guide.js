/* 路由 · guide：使用说明（新人操作手册）。登录用户可读。 */
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { json, requireUser } from './common.js';

const GUIDE_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '../../docs/USER-GUIDE.md');

export async function handleGuide(req, res) {
  await requireUser(req);
  const markdown = await readFile(GUIDE_PATH, 'utf8');
  json(res, 200, { title: '使用说明', markdown });
}
