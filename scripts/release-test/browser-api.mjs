import { createHash } from 'node:crypto';
import { finalizeEvent, nip19 } from 'nostr-tools';

export class BrowserTestError extends Error {}

// Only newly generated runner identities enter this helper. Never log requests,
// signatures, headers, response bodies, or identity objects.
export function createApi(config, identity) {
  let decoded;
  try { decoded = nip19.decode(identity.nsec); }
  catch { throw new BrowserTestError('Generated release identity could not be decoded'); }
  if (decoded.type !== 'nsec') throw new BrowserTestError('Release identity must be an nsec');
  return async (path, { method = 'GET', body, expectedStatus } = {}) => {
    const url = new URL(path, config.towerUrl).href;
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const tags = [['u', url], ['method', method]];
    if (payload !== undefined) tags.push(['payload', createHash('sha256').update(payload).digest('hex')]);
    const event = finalizeEvent({ kind: 27235, created_at: Math.floor(Date.now() / 1000), content: '', tags }, decoded.data);
    const response = await fetch(url, {
      method, body: payload, signal: AbortSignal.timeout(15000),
      headers: {
        authorization: `Nostr ${Buffer.from(JSON.stringify(event)).toString('base64')}`,
        'content-type': 'application/json', 'x-flightdeck-pg-app-npub': config.appNpub,
      },
    });
    if (expectedStatus !== undefined) {
      if (response.status !== expectedStatus) throw new BrowserTestError(`PG ${method} expected ${expectedStatus}, received ${response.status}`);
      await response.body?.cancel();
      return { status: response.status };
    }
    if (!response.ok) throw new BrowserTestError(`PG ${method} ${new URL(url).pathname} failed (${response.status})`);
    return response.json();
  };
}

export function rows(value, key) {
  const result = value?.[key] ?? value?.data?.[key];
  if (!Array.isArray(result)) throw new BrowserTestError(`PG response missing ${key} array`);
  return result;
}

export async function poll(label, fn, timeout = 60000) {
  const deadline = Date.now() + timeout;
  do {
    const value = await fn();
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 500));
  } while (Date.now() < deadline);
  throw new BrowserTestError(`Timed out: ${label} (${timeout}ms)`);
}
