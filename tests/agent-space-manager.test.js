import { describe, expect, it } from 'vitest';
import { formatAgentConnectError, normalizeAgentBoundRows, normalizeAgentPipelineView } from '../src/agent-space-manager.js';

describe('Agent Connect public errors', () => {
  it('shows safe native stage codes and correlation identifiers', () => {
    expect(formatAgentConnectError({
      code: 'health_identity_mismatch',
      message: 'The health identity did not match.',
      correlationId: 'connect-123',
    }, 'Fallback')).toBe('The health identity did not match. [health_identity_mismatch; request connect-123]');
  });

  it('does not render malformed diagnostic metadata', () => {
    expect(formatAgentConnectError({
      code: 'bad code: secret',
      message: 'Connection failed.',
      correlationId: 'bad correlation value',
    }, 'Fallback')).toBe('Connection failed.');
  });
});

describe('Agent Space read projections', () => {
  it('keeps available, assigned, default, override and missing semantics distinct', () => {
    const view = normalizeAgentPipelineView({
      availability_mode: 'explicit', default_mode: 'implicit_library',
      available_definitions: [
        { pipeline_definition_id: 'shared:a', name: 'A', description: 'Available A', scope: 'shared', version: 2, tags: ['one'] },
        { pipeline_definition_id: 'user:b', name: 'B', scope: 'user', version: '3', tags: [] },
      ],
      assignments: [{ pipeline_definition_id: 'shared:a' }],
      defaults: [{ pipeline_definition_id: 'user:b' }],
      overrides: [{ kind: 'channel', context_id: 'channel-1', pipeline_definition_id: 'shared:a' }],
      missing_definition_ids: ['shared:gone'],
    });
    expect(view.availabilityMode).toBe('explicit');
    expect(view.defaultMode).toBe('implicit_library');
    expect(view.definitions).toEqual([
      expect.objectContaining({ id: 'shared:a', assigned: true, default: false, overrides: [{ kind: 'channel', contextId: 'channel-1', pipelineDefinitionId: 'shared:a' }] }),
      expect.objectContaining({ id: 'user:b', assigned: false, default: true }),
    ]);
    expect(view.missing).toEqual([expect.objectContaining({ id: 'shared:gone', missing: true })]);
  });

  it('retains only stable schedule and trigger rows bound to the selected agent identity', () => {
    const agent = { agentId: 'agent-a', botNpub: 'npub-a' };
    const rows = [
      { schedule_id: 'schedule-a', agent_id: 'agent-a', bot_npub: 'npub-a' },
      { schedule_id: 'wrong-agent', agent_id: 'agent-b', bot_npub: 'npub-a' },
      { schedule_id: 'wrong-bot', agent_id: 'agent-a', bot_npub: 'npub-b' },
    ];
    expect(normalizeAgentBoundRows({ schedules: rows }, 'schedules', agent)).toEqual([rows[0]]);
  });
});
