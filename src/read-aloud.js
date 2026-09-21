const DEFAULT_CHUNK_LENGTH = 220;

function decodeCommonEntities(value) {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");
}

export function prepareSpokenText(markdown) {
  return decodeCommonEntities(String(markdown || ''))
    .replace(/```[^\n]*\n?[\s\S]*?```/g, '\nCode block omitted.\n')
    .replace(/~~~[^\n]*\n?[\s\S]*?~~~/g, '\nCode block omitted.\n')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, (_, label) => label ? `Image: ${label}.` : 'Image omitted.')
    .replace(/\[([^\]]+)\]\((?:https?:\/\/|mailto:)[^)]+\)/g, '$1')
    .replace(/@\[([^\]]+)\]\(mention:[^)]+\)/g, '$1')
    .replace(/<(https?:\/\/[^>]+)>/g, '$1')
    .replace(/https?:\/\/(?:www\.)?([^/\s)\]}>,]+)[^\s)\]}>,]*/g, (_, host) => `link to ${host}`)
    .replace(/^\s{0,3}(?:#{1,6}|>|[-+*]|\d+[.)])\s+/gm, '')
    .replace(/\|/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/[*_~]+/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function splitOversizedPart(part, maxLength) {
  const chunks = [];
  let remaining = part.trim();
  while (remaining.length > maxLength) {
    const window = remaining.slice(0, maxLength + 1);
    const sentenceBreak = Math.max(window.lastIndexOf('. '), window.lastIndexOf('? '), window.lastIndexOf('! '));
    const wordBreak = window.lastIndexOf(' ');
    const breakAt = sentenceBreak >= Math.floor(maxLength * 0.45)
      ? sentenceBreak + 1
      : wordBreak >= Math.floor(maxLength * 0.45) ? wordBreak : maxLength;
    chunks.push(remaining.slice(0, breakAt).trim());
    remaining = remaining.slice(breakAt).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

export function chunkSpokenText(text, maxLength = DEFAULT_CHUNK_LENGTH) {
  const limit = Math.max(80, Number(maxLength) || DEFAULT_CHUNK_LENGTH);
  const parts = String(text || '').split(/\n{2,}|(?<=[.!?])\s+/).map((part) => part.trim()).filter(Boolean);
  const chunks = [];
  let current = '';
  for (const part of parts.flatMap((value) => splitOversizedPart(value, limit))) {
    const combined = current ? `${current} ${part}` : part;
    if (combined.length <= limit) current = combined;
    else {
      if (current) chunks.push(current);
      current = part;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

export function createReadAloudController({ speechSynthesis, Utterance, onStateChange = () => {} } = {}) {
  let sessionToken = 0;
  let activeMessageId = '';
  let chunks = [];
  let chunkIndex = 0;

  const supported = Boolean(speechSynthesis && typeof speechSynthesis.speak === 'function' && typeof speechSynthesis.cancel === 'function' && typeof Utterance === 'function');
  const publish = (state, error = '') => onStateChange({ supported, state, messageId: activeMessageId, error });

  function reset(state = 'idle', error = '') {
    activeMessageId = '';
    chunks = [];
    chunkIndex = 0;
    publish(state, error);
  }

  function stop() {
    sessionToken += 1;
    if (supported) speechSynthesis.cancel();
    reset();
  }

  function speakNext(token) {
    if (token !== sessionToken || !activeMessageId) return;
    if (chunkIndex >= chunks.length) {
      reset();
      return;
    }
    const utterance = new Utterance(chunks[chunkIndex]);
    utterance.onend = () => {
      if (token !== sessionToken || !activeMessageId) return;
      chunkIndex += 1;
      speakNext(token);
    };
    utterance.onerror = (event) => {
      if (token !== sessionToken) return;
      sessionToken += 1;
      speechSynthesis.cancel();
      reset('error', event?.error || 'Speech playback failed');
    };
    speechSynthesis.speak(utterance);
  }

  function start(messageId, markdown) {
    if (!supported) return false;
    const spokenText = prepareSpokenText(markdown);
    const nextChunks = chunkSpokenText(spokenText);
    if (!messageId || nextChunks.length === 0) return false;
    sessionToken += 1;
    speechSynthesis.cancel();
    activeMessageId = String(messageId);
    chunks = nextChunks;
    chunkIndex = 0;
    publish('speaking');
    speakNext(sessionToken);
    return true;
  }

  return { supported, start, stop };
}

export const readAloudManagerMixin = {
  initReadAloud() {
    if (this.readAloudController) return;
    const browserWindow = typeof window === 'undefined' ? null : window;
    this.readAloudController = createReadAloudController({
      speechSynthesis: browserWindow?.speechSynthesis,
      Utterance: browserWindow?.SpeechSynthesisUtterance,
      onStateChange: ({ supported, state, messageId, error }) => {
        this.readAloudSupported = supported;
        this.readAloudState = state;
        this.readAloudMessageId = messageId;
        this.readAloudError = error;
      },
    });
    this.readAloudSupported = this.readAloudController.supported;
    if (browserWindow && !this.readAloudPageHideHandler) {
      this.readAloudPageHideHandler = () => this.stopReadAloud();
      browserWindow.addEventListener('pagehide', this.readAloudPageHideHandler);
    }
  },

  canReadMessageAloud(message) {
    return this.readAloudSupported && Boolean(message?.record_id && prepareSpokenText(message?.body));
  },

  isReadingMessageAloud(messageId) {
    return this.readAloudState === 'speaking' && this.readAloudMessageId === String(messageId || '');
  },

  toggleReadAloud(message) {
    if (!this.readAloudController) this.initReadAloud();
    if (this.isReadingMessageAloud(message?.record_id)) this.stopReadAloud();
    else this.readAloudController?.start(message?.record_id, message?.body);
  },

  stopReadAloud() {
    this.readAloudController?.stop();
  },
};
