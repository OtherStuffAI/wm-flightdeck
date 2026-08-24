import { describe, expect, it } from 'vitest';
import {
  normalizeOrderedAutopilotAgents,
  normalizedAutopilotLaunchUrl,
  projectPrimaryAutopilotAgent,
} from '../src/autopilot-agents.js';

describe('ordered Autopilot agents', () => {
  it('migrates the legacy single-agent pair without loss', () => {
    expect(normalizeOrderedAutopilotAgents(undefined, {
      agent_npub: 'npub1testagent',
      url: 'https://agent.example.invalid',
    })).toEqual([{
      agent_npub: 'npub1testagent',
      url: 'https://agent.example.invalid',
    }]);
  });

  it('preserves exact explicit order and suppresses duplicate agent npubs', () => {
    expect(normalizeOrderedAutopilotAgents([
      { agent_npub: 'npub1lara', url: 'https://lara.example' },
      { agent_npub: 'npub1testagent', url: 'https://testagent.example' },
      { agent_npub: 'npub1lara', url: 'https://duplicate.example' },
    ])).toEqual([
      { agent_npub: 'npub1lara', url: 'https://lara.example' },
      { agent_npub: 'npub1testagent', url: 'https://testagent.example' },
    ]);
  });

  it('projects the first ordered entry into the legacy primary fields', () => {
    expect(projectPrimaryAutopilotAgent([
      { agent_npub: 'npub1lara', url: 'https://lara.example' },
      { agent_npub: 'npub1testagent', url: 'https://testagent.example' },
    ])).toEqual({
      wingman_harness_agent_npub: 'npub1lara',
      wingman_harness_url: 'https://lara.example',
    });
  });

  it('accepts bare hostnames but rejects unsafe or credentialed launch URLs', () => {
    expect(normalizedAutopilotLaunchUrl('testagent.example')).toBe('https://testagent.example');
    expect(normalizedAutopilotLaunchUrl('javascript:alert(1)')).toBe('');
    expect(normalizedAutopilotLaunchUrl('https://user:pass@testagent.example')).toBe('');
  });
});
