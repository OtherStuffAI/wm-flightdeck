import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

describe('agent activity template', () => {
  it('renders compact and expanded safe fields without HTML injection', () => {
    expect(html).toContain('getAgentActivitiesForMessage(msg)');
    expect(html).toContain('activeThreadAgentActivities');
    expect(html).toContain('x-text="activity.summary"');
    expect(html).toContain('x-text="activity.body"');
    expect(html).toContain('Show thinking history');
    expect(html).toContain(':aria-expanded="$store.chat.isAgentActivityHistoryExpanded(activity)"');
    expect(html).toContain('x-text="item.body"');
    expect(html).not.toContain('x-html="activity.body"');
    expect(html).not.toContain('x-html="item.body"');
  });

  it('scopes the quieter compact treatment to channel activity', () => {
    expect(html).toContain('class="agent-activity agent-activity-channel agent-activity-live"');
    expect(html).toContain('class="thread-response-activity agent-activity-thread agent-activity-live"');
    expect(css).toContain('.agent-activity-channel .agent-activity-toggle');
    expect(css).toContain('.agent-activity-channel .agent-activity-detail p');
    expect(css).toContain('overflow-wrap: anywhere;');
  });

  it('contains only the blue live activity presentation', () => {
    expect(html).toContain('agent-activity-channel agent-activity-live');
    expect(html).toContain('agent-activity-thread agent-activity-live');
    expect(html).not.toContain('class="agent-activity-health"');
    expect(html).not.toContain('getAgentActivityHealth(activity).state');
  });
});
