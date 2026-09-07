import { describe, it, expect, vi } from 'vitest';
import { uploadWappImage, validateWappImage, WAPP_IMAGE_MAX_BYTES } from '../src/wapp-image-upload.js';

const file = () => new File(['image bytes'], 'icon.png', { type: 'image/png' });
async function setup(status = 201, patch = {}) {
  const input = file();
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await input.arrayBuffer())), n => n.toString(16).padStart(2, '0')).join('');
  const descriptor = { url: `https://blossom.primal.net/${hash}.png`, sha256: hash, size: input.size, type: input.type, ...patch };
  const signEvent = vi.fn(async event => ({ ...event, sig: 'signature', pubkey: 'pubkey' }));
  const fetchImpl = vi.fn(async () => new Response(JSON.stringify(descriptor), { status }));
  return { input, hash, descriptor, signEvent, fetchImpl };
}
describe('Primal WApp image upload', () => {
  it('signs a scoped Blossom event and sends exact binary bytes, returning the descriptor URL', async () => {
    const s = await setup();
    expect(await uploadWappImage(s.input, s)).toBe(s.descriptor.url);
    expect(s.signEvent).toHaveBeenCalledWith(expect.objectContaining({ kind: 24242, tags: expect.arrayContaining([['x', s.hash], ['t', 'upload'], ['server', 'blossom.primal.net']]) }));
    const [url, request] = s.fetchImpl.mock.calls[0];
    expect(url).toBe('https://blossom.primal.net/upload');
    expect(request.body).toBe(s.input);
    expect(request.headers['X-SHA-256']).toBe(s.hash);
    expect(JSON.parse(atob(request.headers.Authorization.slice(6))).kind).toBe(24242);
    expect(request).toMatchObject({ method: 'PUT', credentials: 'omit', redirect: 'error' });
  });
  it('accepts an existing blob response', async () => { const s = await setup(200); expect(await uploadWappImage(s.input, s)).toBe(s.descriptor.url); });
  it.each([{ type: 'image/svg+xml', size: 10 }, { type: 'text/plain', size: 10 }, { type: 'image/png', size: 0 }, { type: 'image/png', size: WAPP_IMAGE_MAX_BYTES + 1 }])('rejects invalid files before signing: %j', async input => {
    const signEvent = vi.fn();
    expect(() => validateWappImage(input)).toThrow();
    await expect(uploadWappImage(input, { signEvent })).rejects.toThrow();
    expect(signEvent).not.toHaveBeenCalled();
  });
  it.each([401, 402, 403, 413, 415, 429, 500])('reports HTTP %s without treating it as success', async status => { const s = await setup(status); await expect(uploadWappImage(s.input, s)).rejects.toThrow(/Primal/); });
  it.each([{ url: 'javascript:alert(1)' }, { url: 'https://user:pass@example.com/icon.png' }, { sha256: 'wrong' }, { size: 900 }, { type: 'text/html' }])('rejects invalid descriptors %j', async patch => { const s = await setup(200, patch); await expect(uploadWappImage(s.input, s)).rejects.toThrow(/invalid/); });
  it('reports signing cancellation and sends nothing', async () => { const s = await setup(); s.signEvent.mockRejectedValue(new Error('Denied')); await expect(uploadWappImage(s.input, s)).rejects.toThrow(/signing failed/); expect(s.fetchImpl).not.toHaveBeenCalled(); });
  it('does not upload after cancellation during signing', async () => { const s = await setup(); const controller = new AbortController(); s.signEvent.mockImplementation(async event => { controller.abort(); return event; }); await expect(uploadWappImage(s.input, { ...s, signal: controller.signal })).rejects.toThrow(); expect(s.fetchImpl).not.toHaveBeenCalled(); });
  it('cancels a signer that never resolves', async () => {
    const s = await setup(); const controller = new AbortController();
    s.signEvent.mockImplementation(() => new Promise(() => {}));
    const pending = uploadWappImage(s.input, { ...s, signal: controller.signal });
    const assertion = expect(pending).rejects.toThrow();
    await vi.waitFor(() => expect(s.signEvent).toHaveBeenCalled());
    controller.abort(); await assertion; expect(s.fetchImpl).not.toHaveBeenCalled();
  });
  it('reports network/CORS and malformed JSON failures', async () => { const s = await setup(); s.fetchImpl.mockRejectedValueOnce(new TypeError('Failed to fetch')); await expect(uploadWappImage(s.input, s)).rejects.toThrow(/connection/); s.fetchImpl.mockResolvedValueOnce(new Response('not json')); await expect(uploadWappImage(s.input, s)).rejects.toThrow(/invalid upload response/); });
});
