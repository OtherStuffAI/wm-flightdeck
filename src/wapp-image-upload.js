import { signNostrEvent } from './auth/nostr.js';

export const PRIMAL_BLOSSOM_URL = 'https://blossom.primal.net';
export const WAPP_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const WAPP_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

export function validateWappImage(file) {
  if (!file || !WAPP_IMAGE_TYPES.includes(file.type)) throw new Error('Choose a PNG, JPEG, GIF, or WebP image.');
  if (!file.size) throw new Error('This image is empty. Choose another image.');
  if (file.size > WAPP_IMAGE_MAX_BYTES) throw new Error('Choose an image no larger than 5 MiB.');
}

// A dismissed signer prompt must not keep a cancelled upload pending forever.
function abortable(promise, signal) {
  if (!signal) return promise;
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

export async function uploadWappImage(file, { signal, signEvent = signNostrEvent, fetchImpl = fetch } = {}) {
  validateWappImage(file);
  signal?.throwIfAborted();
  const bytes = await file.arrayBuffer();
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (n) => n.toString(16).padStart(2, '0')).join('');
  signal?.throwIfAborted();
  const now = Math.floor(Date.now() / 1000);
  let signed;
  try {
    signed = await abortable(signEvent({ kind: 24242, created_at: now, content: 'Upload WApp icon to Primal Blossom', tags: [
      ['t', 'upload'], ['x', hash], ['expiration', String(now + 300)], ['server', new URL(PRIMAL_BLOSSOM_URL).hostname],
    ] }), signal);
  } catch (error) {
    throw new Error(`Image signing failed or was cancelled. ${error?.message || 'Try again with your Nostr signer.'}`);
  }
  signal?.throwIfAborted();
  let response;
  try {
    response = await fetchImpl(`${PRIMAL_BLOSSOM_URL}/upload`, {
      method: 'PUT', body: file, signal, credentials: 'omit', redirect: 'error',
      headers: { Authorization: `Nostr ${btoa(JSON.stringify(signed))}`, 'Content-Type': file.type, 'X-SHA-256': hash },
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new Error('Could not reach Primal Blossom. Check your connection or browser upload restrictions and retry.');
  }
  if (!response.ok) {
    const reasons = { 401: 'Primal rejected the signing authorization.', 403: 'Primal does not allow this upload.', 402: 'Primal requires payment or an eligible account.', 413: 'Primal rejected the image size.', 415: 'Primal rejected the image type.', 429: 'Primal is rate limiting uploads. Try again later.' };
    throw new Error(reasons[response.status] || `Primal upload failed (HTTP ${response.status}). Try again.`);
  }
  let descriptor;
  try { descriptor = await response.json(); } catch { throw new Error('Primal returned an invalid upload response. Retry the upload.'); }
  let url;
  try { url = new URL(descriptor?.url); } catch { /* checked below */ }
  if (!url || url.protocol !== 'https:' || url.username || url.password || descriptor.sha256 !== hash || descriptor.size !== file.size || !WAPP_IMAGE_TYPES.includes(descriptor.type)) {
    throw new Error('Primal returned an invalid image URL or mismatched image details. Retry the upload.');
  }
  return url.href;
}
