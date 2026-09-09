// Runs only inside the isolated Tower mesh namespace. Every forwarded request
// still enters Tower's real FIPS listener with its original Host and signature.
import { createServer, request } from 'node:http';
import { readFileSync, appendFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const activeStreams = new Map();
const stateFile = '/mesh/fault-state.json';
try { writeFileSync(stateFile, JSON.stringify({ blockSse: false, dropReply: false }), { flag: 'wx' }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
const readState = () => JSON.parse(readFileSync(stateFile, 'utf8'));
const record = (value) => appendFileSync('/mesh/fault-ledger.jsonl', JSON.stringify({ at: new Date().toISOString(), ...value }) + '\n');
setInterval(() => {
  if (readState().blockSse) for (const [response, entry] of activeStreams) {
    record({ ...entry, fault: 'established-sse-closed' });
    activeStreams.delete(response); response.destroy();
  }
}, 100);
createServer(async (incoming, response) => {
  const state = readState();
  const isStream = incoming.url.includes('/events/stream');
  if (isStream && state.blockSse) {
    record({ fault: 'sse-denied', method: incoming.method, path: incoming.url });
    response.writeHead(503); response.end(); return;
  }
  const chunks = [];
  for await (const chunk of incoming) chunks.push(chunk);
  const bytes = Buffer.concat(chunks);
  const upstream = request({ hostname: process.env.TOWER_MESH_ADDRESS, port: 43100,
    method: incoming.method, path: incoming.url, headers: incoming.headers, agent: false,
  }, async (result) => {
    const entry = { method: incoming.method, path: incoming.url, status: result.statusCode,
      bodySha256: createHash('sha256').update(bytes).digest('hex'),
    };
    if (incoming.method === 'POST' && /\/messages$/.test(incoming.url) && result.statusCode < 300) {
      const reply = []; for await (const chunk of result) reply.push(chunk);
      const responseBytes = Buffer.concat(reply);
      const body = JSON.parse(responseBytes.toString());
      const requestBody = JSON.parse(bytes.toString());
      const publication = { ...entry, requestKey: requestBody.client_request_id,
        recordId: body.message?.id, replayed: body.replayed === true };
      if (state.dropReply) {
        writeFileSync(stateFile, JSON.stringify({ ...readState(), dropReply: false }));
        record({ ...publication, fault: 'committed-response-dropped' });
        response.destroy(); return;
      }
      record(publication);
      response.writeHead(result.statusCode, result.headers); response.end(responseBytes); return;
    }
    record(entry);
    response.writeHead(result.statusCode, result.headers);
    if (isStream && result.statusCode === 200) activeStreams.set(response, entry);
    response.on('close', () => { activeStreams.delete(response); result.destroy(); });
    result.pipe(response);
  });
  upstream.on('error', () => { if (!response.headersSent) response.writeHead(502); response.end(); });
  response.on('close', () => upstream.destroy());
  upstream.end(bytes);
}).listen(43102, '::');
