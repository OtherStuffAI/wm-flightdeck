import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Hang call UI', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

  it('offers the thread action with an in-flight disabled state', () => {
    expect(html).toContain('$store.chat.startThreadHangCall()');
    expect(html).toContain(':disabled="$store.chat.threadHangCallSending"');
  });

  it('offers the channel action with duplicate blocking and retry feedback', () => {
    expect(html).toContain('$store.chat.startChannelHangCall()');
    expect(html).toContain(':disabled="$store.chat.channelHangCallSending"');
    expect(html).toContain('$store.chat.retryChannelHangCall()');
  });

  it('renders a recognisable Join action with safe new-tab attributes', () => {
    expect(html).toContain('class="chat-hang-call-card"');
    expect(html).toContain('target="_blank" rel="noopener noreferrer">Join call</a>');
    expect(html).toContain('Anyone who receives this link can join.');
  });

  it('renders recoverable failure feedback', () => {
    expect(html).toContain('class="chat-hang-call-error"');
    expect(html).toContain('$store.chat.retryThreadHangCall()');
  });
});
