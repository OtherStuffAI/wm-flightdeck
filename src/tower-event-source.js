import { towerFetch, usesNativeTowerTransport } from './tower-transport.js';

// Native transport supplies bytes, while the existing worker remains the only
// SSE lifecycle/reconnect owner. HTTPS retains the browser EventSource.
export function createTowerEventSource(url) {
  return usesNativeTowerTransport(url) ? new NativeTowerEventSource(url) : new EventSource(url);
}

export class NativeTowerEventSource extends EventTarget {
  constructor(url) {
    super();
    this.readyState = 0;
    this.controller = new AbortController();
    this.onerror = null;
    void this.read(url);
  }

  close() {
    this.readyState = 2;
    this.controller.abort();
  }

  async read(url) {
    let reader;
    try {
      const response = await towerFetch(url, { headers: { Accept: 'text/event-stream' }, signal: this.controller.signal });
      if (!response.ok || !response.headers.get('content-type')?.startsWith('text/event-stream') || !response.body) {
        throw new Error('SSE stream rejected.');
      }
      this.readyState = 1;
      this.dispatchEvent(new Event('open'));
      reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let data = [];
      let eventType = '';
      let lastEventId = '';
      const line = (value) => {
        if (!value) {
          if (data.length) this.dispatchEvent(new MessageEvent(eventType || 'message', { data: data.join('\n'), lastEventId }));
          data = [];
          eventType = '';
          return;
        }
        if (value.startsWith(':')) return;
        const colon = value.indexOf(':');
        const field = colon < 0 ? value : value.slice(0, colon);
        let content = colon < 0 ? '' : value.slice(colon + 1);
        if (content.startsWith(' ')) content = content.slice(1);
        if (field === 'data') data.push(content);
        else if (field === 'event') eventType = content;
        else if (field === 'id' && !content.includes('\0')) lastEventId = content;
        // Retry policy belongs to the existing worker, not the byte adapter.
      };
      while (this.readyState !== 2) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        if (buffer.length + data.reduce((n, value) => n + value.length, 0) > 1024 * 1024) throw new Error('SSE event too large.');
        while (true) {
          const newline = buffer.search(/[\r\n]/);
          if (newline < 0 || (buffer[newline] === '\r' && newline === buffer.length - 1)) break;
          const width = buffer[newline] === '\r' && buffer[newline + 1] === '\n' ? 2 : 1;
          line(buffer.slice(0, newline));
          buffer = buffer.slice(newline + width);
        }
      }
      if (this.readyState !== 2) throw new Error('SSE stream ended.');
    } catch {
      if (this.readyState !== 2) {
        this.readyState = 2;
        const event = new Event('error');
        this.onerror?.(event);
        this.dispatchEvent(event);
      }
    } finally {
      await reader?.cancel().catch(() => {});
      reader?.releaseLock();
    }
  }
}
