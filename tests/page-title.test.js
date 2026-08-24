import { describe, expect, it } from 'vitest';
import { buildFlightDeckDocumentTitle } from '../src/page-title.js';

describe('page title', () => {
  it('builds task titles', () => {
    expect(buildFlightDeckDocumentTitle({ section: 'tasks' })).toBe('Tasks - Wingman: Deck');
    expect(buildFlightDeckDocumentTitle({ section: 'tasks', workspaceLabel: 'Operator A' })).toBe('Tasks | Operator A - Wingman: Deck');
    expect(buildFlightDeckDocumentTitle({ section: 'workroom', workspaceLabel: 'Operator A' })).toBe('Workroom | Operator A - Wingman: Deck');
    expect(buildFlightDeckDocumentTitle({ section: 'opportunities' })).toBe('Opportunities - Wingman: Deck');
    expect(buildFlightDeckDocumentTitle({ section: 'settings' })).toBe('Setup - Wingman: Deck');
  });

  it('builds chat titles with channel context', () => {
    expect(buildFlightDeckDocumentTitle({ section: 'chat' })).toBe('Chat - Wingman: Deck');
    expect(buildFlightDeckDocumentTitle({ section: 'chat', channelLabel: 'Agent B' })).toBe('Chat | Agent B - Wingman: Deck');
    expect(buildFlightDeckDocumentTitle({ section: 'chat', workspaceLabel: 'Example Workspace', channelLabel: 'Agent B' })).toBe('Chat | Example Workspace | Agent B - Wingman: Deck');
  });

  it('falls back to chat titles for removed or unknown sections', () => {
    expect(buildFlightDeckDocumentTitle({ section: 'live' })).toBe('Chat - Wingman: Deck');
    expect(buildFlightDeckDocumentTitle({ section: 'calendar' })).toBe('Chat - Wingman: Deck');
    expect(buildFlightDeckDocumentTitle({ section: 'schedules' })).toBe('Chat - Wingman: Deck');
    expect(buildFlightDeckDocumentTitle({ section: 'scopes' })).toBe('Chat - Wingman: Deck');
    expect(buildFlightDeckDocumentTitle({ section: 'flows' })).toBe('Chat - Wingman: Deck');
  });

  it('builds docs titles from folder or document context', () => {
    expect(buildFlightDeckDocumentTitle({ section: 'docs', folderLabel: 'Ops' })).toBe('Docs | Ops - Wingman: Deck');
    expect(buildFlightDeckDocumentTitle({ section: 'docs', workspaceLabel: 'Operator A', docTitle: 'Launch Plan' })).toBe('Docs | Operator A | Launch Plan - Wingman: Deck');
  });
});
