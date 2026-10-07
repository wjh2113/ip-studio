/* 语义召回（没有 pgvector：取回向量在 Node 里算，结果要和库里算一致） */
import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { semanticSuite, startFakeGateway } from './semantic.shared.js';

process.env.PGVECTOR = 'off';
const server = await startFakeGateway();
test.after(() => server.close());
semanticSuite(test, assert, { expectPgvector: false });
