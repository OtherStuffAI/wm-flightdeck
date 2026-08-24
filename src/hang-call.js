const HANG_ROOM_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const HANG_ROOM_LENGTH = 63;
const HANG_INVITATION_PREFIX = '📞 Hang call invitation';
const HANG_URL_PATTERN = /https:\/\/hang\.live\/@([A-Za-z0-9]{63})(?:\b|$)/;

export function generateHangRoomId(cryptoApi = globalThis.crypto) {
  if (!cryptoApi?.getRandomValues) throw new Error('Secure random generation is unavailable in this browser.');
  const output = [];
  const maxAcceptedByte = Math.floor(256 / HANG_ROOM_ALPHABET.length) * HANG_ROOM_ALPHABET.length;
  while (output.length < HANG_ROOM_LENGTH) {
    const bytes = new Uint8Array(Math.max(16, HANG_ROOM_LENGTH - output.length));
    cryptoApi.getRandomValues(bytes);
    for (const byte of bytes) {
      if (byte >= maxAcceptedByte) continue;
      output.push(HANG_ROOM_ALPHABET[byte % HANG_ROOM_ALPHABET.length]);
      if (output.length === HANG_ROOM_LENGTH) break;
    }
  }
  return output.join('');
}

export function createHangRoomUrl(cryptoApi = globalThis.crypto) {
  return `https://hang.live/@${generateHangRoomId(cryptoApi)}`;
}

export function buildHangCallInvitation(roomUrl) {
  if (!HANG_URL_PATTERN.test(String(roomUrl || ''))) throw new Error('Invalid Hang room URL.');
  return `${HANG_INVITATION_PREFIX}\n\n${roomUrl}\n\nThis is an unguessable public link. Anyone who receives it can join.`;
}

export function parseHangCallInvitation(body) {
  const text = String(body || '');
  if (!text.startsWith(HANG_INVITATION_PREFIX)) return null;
  const match = text.match(HANG_URL_PATTERN);
  return match ? { roomUrl: match[0] } : null;
}
