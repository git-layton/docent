import { describe, it, expect } from 'vitest';
import {
  INTENTS,
  parseIntent,
  cycleIntent,
  specFor,
  webSearchUrl,
  type OmniIntent,
} from '../../services/omniIntent';

describe('parseIntent', () => {
  it('leaves plain text in auto with no prefix stripped', () => {
    expect(parseIntent('rust notes')).toEqual({ hadPrefix: false, intent: 'auto', text: 'rust notes' });
  });

  it('recognizes each prefix and strips it (plus the following space)', () => {
    expect(parseIntent('>calendar')).toEqual({ hadPrefix: true, intent: 'app', text: 'calendar' });
    expect(parseIntent('? weather')).toEqual({ hadPrefix: true, intent: 'web', text: 'weather' });
    expect(parseIntent('#project plan')).toEqual({ hadPrefix: true, intent: 'knowledge', text: 'project plan' });
  });

  it('does NOT aim on a lone prefix with no text after it', () => {
    for (const p of ['>', '?', '#', '>   ']) {
      const r = parseIntent(p);
      expect(r.hadPrefix).toBe(false);
      expect(r.intent).toBe('auto');
      expect(r.text).toBe(p);
    }
  });

  it('ignores an unknown leading character', () => {
    expect(parseIntent('@handle')).toEqual({ hadPrefix: false, intent: 'auto', text: '@handle' });
  });

  it('handles the empty string', () => {
    expect(parseIntent('')).toEqual({ hadPrefix: false, intent: 'auto', text: '' });
  });
});

describe('cycleIntent', () => {
  it('advances in INTENTS order and wraps', () => {
    const order = INTENTS.map((s) => s.intent);
    let cur: OmniIntent = order[0];
    const walked: OmniIntent[] = [cur];
    for (let i = 0; i < order.length; i++) {
      cur = cycleIntent(cur);
      walked.push(cur);
    }
    // After N steps we're back at the start.
    expect(walked).toEqual([...order, order[0]]);
  });
});

describe('specFor', () => {
  it('returns the spec for a known intent', () => {
    expect(specFor('app').prefix).toBe('>');
    expect(specFor('auto').prefix).toBeUndefined();
  });
});

describe('webSearchUrl', () => {
  it('builds an encoded DuckDuckGo query and trims', () => {
    expect(webSearchUrl('  hello world  ')).toBe('https://start.duckduckgo.com/?q=hello%20world');
    expect(webSearchUrl('a&b=c')).toBe('https://start.duckduckgo.com/?q=a%26b%3Dc');
  });
});
