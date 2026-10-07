/* 语义召回（装了 pgvector：相似度在库里算） */
import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { semanticSuite, startFakeGateway } from './semantic.shared.js';

const server = await startFakeGateway();
test.after(() => server.close());
semanticSuite(test, assert, { expectPgvector: true });
