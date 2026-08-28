import 'fake-indexeddb/auto';
import { parentPort } from 'node:worker_threads';

globalThis.__FLIGHT_DECK_PG_APP_NPUB__ = 'npub1materializationresponsivenesstest';
globalThis.self = {
  addEventListener(type, listener) {
    if (type === 'message') parentPort.on('message', (data) => listener({ data }));
  },
  postMessage(message) {
    parentPort.postMessage(message);
  },
};

await import('../../src/worker/tower-pg-materialization-worker.js');
