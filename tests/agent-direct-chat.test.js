import { describe, expect, it } from 'vitest';
import {
  canonicalAgentMentionsFromSelection,
  filterMentionsToCurrentWorkspaceActors,
  readAgentChatConfig,
  writeAgentChatConfig,
} from '../src/agent-direct-chat.js';

describe('Agent Direct Chat contract helpers', () => {
  it('compatibly reads old prompts and writes only canonical agent_chat metadata', () => {
    expect(readAgentChatConfig({ basePrompt: 'Legacy context' })).toEqual({
      enabled: true,
      context_prompt: 'Legacy context',
      activation: 'mention_then_continue',
    });

    expect(readAgentChatConfig({ agent_chat: { enabled: false, context_prompt: 'Persisted context' } })).toEqual({
      enabled: true,
      context_prompt: 'Persisted context',
      activation: 'mention_then_continue',
    });

    expect(writeAgentChatConfig({ agent_chat: { enabled: false } }, {
      enabled: false,
      context_prompt: 'Universal context',
    }).agent_chat).toEqual({
      enabled: true,
      context_prompt: 'Universal context',
      activation: 'mention_then_continue',
    });

    expect(writeAgentChatConfig({ basePrompt: 'Legacy', retained: true }, {
      enabled: true,
      context_prompt: '',
    })).toEqual({
      retained: true,
      agent_chat: {
        enabled: true,
        context_prompt: '',
        activation: 'mention_then_continue',
      },
    });
  });

  it('builds canonical actor mentions only from picker selections still present in the body', () => {
    const testagent = 'npub1lycg5qvjtrp3qjf5f7zl382j9x6nrjz9sdhenvyxq8c3808qxmus6gq266';
    const sam = `npub1${'q'.repeat(58)}`;
    expect(canonicalAgentMentionsFromSelection(
      `@Test Agent typed only @[Test Agent](mention:agent:${testagent}) and @[Sam](mention:agent:${sam})`,
      [
        { type: 'agent', npub: testagent, label: 'Test Agent' },
        { type: 'agent', npub: sam, label: 'Sam' },
      ],
    )).toEqual([
      { type: 'agent', npub: testagent, label: 'Test Agent' },
      { type: 'agent', npub: sam, label: 'Sam' },
    ]);
    expect(canonicalAgentMentionsFromSelection('@Test Agent typed only', [
      { type: 'agent', npub: testagent, label: 'Test Agent' },
    ])).toEqual([]);
    expect(canonicalAgentMentionsFromSelection(`@[Test Agent](mention:agent:${testagent})`, [])).toEqual([]);
    expect(canonicalAgentMentionsFromSelection(
      `@[Test Agent](mention:person:${testagent})`,
      [{ type: 'person', npub: testagent, label: 'Test Agent' }],
    )).toEqual([{ type: 'person', npub: testagent, label: 'Test Agent' }]);
  });

  it('rejects retired mention npubs once the current Tower actor roster is available', () => {
    const retired = 'npub1retired';
    const current = 'npub1current';
    const mentions = [
      { type: 'agent', npub: retired, label: 'Example Agent' },
      { type: 'agent', npub: current, label: 'Example Agent' },
    ];
    expect(filterMentionsToCurrentWorkspaceActors(mentions, [])).toEqual(mentions);
    expect(filterMentionsToCurrentWorkspaceActors(mentions, [
      { actor_id: 'actor-example-agent', npub: current },
    ])).toEqual([{ type: 'agent', npub: current, label: 'Example Agent' }]);
  });
});
