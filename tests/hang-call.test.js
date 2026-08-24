import { describe, expect, it } from 'vitest';
import {
  buildHangCallInvitation,
  createHangRoomUrl,
  generateHangRoomId,
  parseHangCallInvitation,
} from '../src/hang-call.js';

describe('Hang call invitations', () => {
  it('generates a 63-character alphanumeric id with cryptographic random bytes', () => {
    let calls = 0;
    const cryptoApi = {
      getRandomValues(bytes) {
        calls += 1;
        bytes.fill(7);
        return bytes;
      },
    };
    const roomId = generateHangRoomId(cryptoApi);
    expect(roomId).toMatch(/^[A-Za-z0-9]{63}$/);
    expect(calls).toBeGreaterThan(0);
    expect(createHangRoomUrl(cryptoApi)).toMatch(/^https:\/\/hang\.live\/@[A-Za-z0-9]{63}$/);
  });

  it('renders only recognisable, valid invitations as call cards', () => {
    const url = `https://hang.live/@${'A'.repeat(63)}`;
    const body = buildHangCallInvitation(url);
    expect(body).toContain('unguessable public link');
    expect(body).toContain('Anyone who receives it can join');
    expect(parseHangCallInvitation(body)).toEqual({ roomUrl: url });
    expect(parseHangCallInvitation(`ordinary message ${url}`)).toBeNull();
    expect(() => buildHangCallInvitation('https://example.com/not-hang')).toThrow('Invalid Hang room URL');
  });
});
