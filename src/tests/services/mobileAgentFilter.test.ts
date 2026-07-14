import { describe, it, expect } from 'vitest';
import { filterMobileAgents } from '../../services/mobileAgentFilter';

const BUILTINS = [
  { id: 'alexis', name: 'Alexis', isDefault: true },
  { id: 'forge-dev', name: 'Codey', isDefault: true },
  { id: 'forge-guide', name: 'Forge Guide', isDefault: true },
  { id: 'f-default', name: 'Assistant', isDefault: true },
];

describe('filterMobileAgents', () => {
  it('shows Alexis and hides the other built-ins', () => {
    const visible = filterMobileAgents(BUILTINS);
    expect(visible.map(a => a.id)).toEqual(['alexis']);
  });

  it('shows every user-created agent alongside Alexis', () => {
    const custom = [
      { id: 'agent-1', name: 'Scout' },
      { id: 'agent-2', name: 'Recipe Coach' },
    ];
    const visible = filterMobileAgents([...BUILTINS, ...custom]);
    expect(visible.map(a => a.id)).toEqual(['alexis', 'agent-1', 'agent-2']);
  });

  it('keeps a user agent even if it clones a built-in name like Codey', () => {
    const clone = { id: 'agent-3', name: 'Codey Jr', role: 'Engineer' };
    const visible = filterMobileAgents([...BUILTINS, clone]);
    expect(visible.map(a => a.id)).toContain('agent-3');
  });

  it('handles empty and malformed lists', () => {
    expect(filterMobileAgents([])).toEqual([]);
    expect(filterMobileAgents([null, undefined] as any[])).toEqual([]);
  });
});
