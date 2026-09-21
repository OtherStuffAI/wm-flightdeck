import { describe, expect, it, vi } from 'vitest';
import {
  chunkSpokenText,
  createReadAloudController,
  prepareSpokenText,
  readAloudManagerMixin,
} from '../src/read-aloud.js';

class FakeUtterance {
  constructor(text) {
    this.text = text;
    this.onend = null;
    this.onerror = null;
  }
}

function createSpeechHarness() {
  const spoken = [];
  const speechSynthesis = {
    cancel: vi.fn(),
    speak: vi.fn((utterance) => spoken.push(utterance)),
  };
  const states = [];
  const controller = createReadAloudController({
    speechSynthesis,
    Utterance: FakeUtterance,
    onStateChange: (state) => states.push(state),
  });
  return { controller, speechSynthesis, spoken, states };
}

describe('read aloud text preparation', () => {
  it('turns message Markdown into useful spoken plain text without mutating the source', () => {
    const source = '# Result\n\nUse **Flight Deck** and [`Tower`](https://example.com/tower).\n\n```js\nconst secret = true;\n```\nSee https://www.example.org/long/path?q=1 and @[Rick](mention:agent:npub1rick).';
    const spoken = prepareSpokenText(source);

    expect(source).toContain('```js');
    expect(spoken).toBe('Result\n\nUse Flight Deck and Tower.\n\nCode block omitted.\n\nSee link to example.org and Rick.');
    expect(spoken).not.toContain('```');
    expect(spoken).not.toContain('https://');
  });

  it('uses accessible image labels and removes inline Markdown punctuation', () => {
    expect(prepareSpokenText('![Architecture](image.png) `speechSynthesis` _works_.'))
      .toBe('Image: Architecture. speechSynthesis works.');
  });
});

describe('read aloud chunking', () => {
  it('keeps conservative chunks in order and splits oversized passages at words', () => {
    const text = `${'First sentence. '.repeat(12)}\n\n${'mobile '.repeat(60)}`;
    const chunks = chunkSpokenText(text, 100);

    expect(chunks.length).toBeGreaterThan(3);
    expect(chunks.every((chunk) => chunk.length <= 100)).toBe(true);
    expect(chunks.join(' ')).toContain('First sentence.');
    expect(chunks.join(' ')).toContain('mobile mobile');
  });
});

describe('read aloud queue controller', () => {
  it('queues one chunk at a time and returns to idle after completion', () => {
    const { controller, spoken, states } = createSpeechHarness();
    const body = `${'One sentence. '.repeat(20)}Final sentence.`;

    expect(controller.start('message-1', body)).toBe(true);
    expect(spoken).toHaveLength(1);
    expect(states.at(-1)).toMatchObject({ state: 'speaking', messageId: 'message-1' });

    while (states.at(-1).state === 'speaking') spoken.at(-1).onend();
    expect(spoken.length).toBeGreaterThan(1);
    expect(states.at(-1)).toMatchObject({ state: 'idle', messageId: '' });
  });

  it('cancels the old queue when switching messages and ignores its stale onend', () => {
    const { controller, speechSynthesis, spoken, states } = createSpeechHarness();
    controller.start('first', `${'Old queue sentence. '.repeat(30)}`);
    const staleUtterance = spoken[0];

    controller.start('second', 'New message.');
    expect(speechSynthesis.cancel).toHaveBeenCalledTimes(2);
    expect(states.at(-1)).toMatchObject({ state: 'speaking', messageId: 'second' });
    const countAfterSwitch = spoken.length;

    staleUtterance.onend();
    expect(spoken).toHaveLength(countAfterSwitch);
    expect(states.at(-1)).toMatchObject({ state: 'speaking', messageId: 'second' });
  });

  it('keeps state accurate after explicit stop and speech errors', () => {
    const { controller, speechSynthesis, spoken, states } = createSpeechHarness();
    controller.start('message-1', 'Speak this.');
    controller.stop();
    expect(states.at(-1)).toMatchObject({ state: 'idle', messageId: '' });
    expect(speechSynthesis.cancel).toHaveBeenCalledTimes(2);

    controller.start('message-2', 'This errors.');
    spoken.at(-1).onerror({ error: 'synthesis-failed' });
    expect(states.at(-1)).toMatchObject({ state: 'error', messageId: '', error: 'synthesis-failed' });
  });

  it('degrades without Web Speech support', () => {
    const states = [];
    const controller = createReadAloudController({ onStateChange: (state) => states.push(state) });
    expect(controller.supported).toBe(false);
    expect(controller.start('message', 'Hello')).toBe(false);
    expect(states).toEqual([]);

    const store = { ...readAloudManagerMixin, readAloudSupported: false };
    expect(store.canReadMessageAloud({ record_id: 'message', body: 'Hello' })).toBe(false);
  });
});

describe('read aloud store state', () => {
  it('stops active speech when the thread closes', async () => {
    const source = await import('../src/chat-message-manager.js');
    const stopReadAloud = vi.fn();
    const store = {
      stopReadAloud,
      messageEdit: {},
      saveChatComposerDraft: vi.fn(),
      clearChatFileDrafts: vi.fn(),
      startWorkspaceLiveQueries: vi.fn(),
      syncRoute: vi.fn(),
      THREAD_REPLY_PAGE_SIZE: 6,
    };

    expect(source.chatMessageManagerMixin.closeThread.call(store)).toBe(true);
    expect(stopReadAloud).toHaveBeenCalledOnce();
  });
});
