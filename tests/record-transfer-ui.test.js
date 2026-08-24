import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

describe('record transfer UI', () => {
  it('exposes Move to and Tag in Chat actions for task and document surfaces', () => {
    expect(html.match(/openRecordMove\('task'/g)?.length).toBeGreaterThanOrEqual(1);
    expect(html.match(/openRecordTagInChat\('task'/g)?.length).toBeGreaterThanOrEqual(1);
    expect(html.match(/openRecordMove\('document'/g)?.length).toBeGreaterThanOrEqual(2);
    expect(html.match(/openRecordTagInChat\('document'/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it('uses an accessible responsive destination dialog with live errors', () => {
    expect(html).toContain('data-testid="record-transfer-modal"');
    expect(html).toContain('role="dialog" aria-modal="true"');
    expect(html).toContain('data-testid="record-transfer-scope"');
    expect(html).toContain('data-testid="record-transfer-channel"');
    expect(html).not.toContain('data-testid="record-transfer-thread"');
    expect(html).toContain('will create and open a new thread');
    expect(html).toContain('Start new thread');
    expect(html).toContain('role="alert" aria-live="assertive"');
    expect(css).toContain('.record-transfer-modal');
    expect(css).toMatch(/@media \(max-width: 540px\).*\.record-transfer-modal/s);
  });
});
