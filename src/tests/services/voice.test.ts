import { describe, it, expect } from 'vitest';
import {
  cleanEmailBody,
  cleanSamples,
  DRAFT_DELIM,
  normalizeVoiceProfile,
  parseDrafts,
  relKeyForEmail,
  relKeyForImessage,
  renderVoiceBlock,
  resolveRecipientCard,
  voiceActiveFor,
} from '../../services/voice';

describe('normalizeVoiceProfile — tolerates partial/old shapes', () => {
  it('fills defaults from undefined', () => {
    const vp = normalizeVoiceProfile(undefined);
    expect(vp.enabled).toBe(false);
    expect(vp.card).toBe('');
    expect(vp.perSurface).toEqual({ chat: true, imessage: true, email: true });
  });

  it('treats only explicit false as off per surface', () => {
    const vp = normalizeVoiceProfile({ perSurface: { imessage: false } });
    expect(vp.perSurface).toEqual({ chat: true, imessage: false, email: true });
  });

  it('coerces a non-string card to empty', () => {
    expect(normalizeVoiceProfile({ card: 123 }).card).toBe('');
  });

  it('normalizes the per-recipient map and its entries', () => {
    const vp = normalizeVoiceProfile({ byRecipient: { 'im:42': { card: 'casual', optedIn: true, label: 'partner', source: 'auto' }, '': { card: 'x' }, 'bad': { card: 99, optedIn: 'yes', label: 'nope' } } });
    expect(vp.byRecipient?.['']).toBeUndefined();           // empty key dropped
    expect(vp.byRecipient?.['im:42']).toMatchObject({ card: 'casual', optedIn: true, label: 'partner', source: 'auto' });
    expect(vp.byRecipient?.['bad']).toMatchObject({ card: '', optedIn: false });  // coerced
    expect(vp.byRecipient?.['bad'].label).toBeUndefined();  // invalid label dropped
  });
});

describe('per-relationship keying & selection', () => {
  it('builds PII-minimal relationship keys', () => {
    expect(relKeyForImessage(42)).toBe('im:42');
    expect(relKeyForImessage('abc')).toBe('im:abc');
    expect(relKeyForImessage(null)).toBeNull();
    expect(relKeyForImessage('')).toBeNull();
    expect(relKeyForEmail('Sarah <Sarah@Acme.com>')).toBe('mail:sarah@acme.com');
    expect(relKeyForEmail('a@b.com, c@d.com')).toBe('mail:a@b.com'); // first address
    expect(relKeyForEmail('not an address')).toBeNull();
  });

  it('resolveRecipientCard prefers an opted-in recipient card, else the global fallback', () => {
    const vp = {
      card: 'GLOBAL',
      byRecipient: {
        'im:1': { card: 'BOSS', optedIn: true },
        'im:2': { card: 'DRAFT', optedIn: false },   // not opted in
        'im:3': { card: '   ', optedIn: true },       // opted in but empty
      },
    };
    expect(resolveRecipientCard(vp, 'im:1')).toBe('BOSS');     // opted-in recipient wins
    expect(resolveRecipientCard(vp, 'im:2')).toBe('GLOBAL');   // not opted in → global
    expect(resolveRecipientCard(vp, 'im:3')).toBe('GLOBAL');   // empty card → global
    expect(resolveRecipientCard(vp, 'im:404')).toBe('GLOBAL'); // no entry → global
    expect(resolveRecipientCard(vp, null)).toBe('GLOBAL');     // no key → global
    expect(resolveRecipientCard({ card: '' }, 'im:1')).toBe(''); // nothing anywhere → empty
  });
});

describe('voiceActiveFor / renderVoiceBlock — gating', () => {
  const card = 'casual, lowercase, lots of ellipses…';

  it('is inactive unless enabled AND has a card AND the surface is on', () => {
    expect(voiceActiveFor({ enabled: false, card }, 'chat')).toBe(false);
    expect(voiceActiveFor({ enabled: true, card: '' }, 'chat')).toBe(false);
    expect(voiceActiveFor({ enabled: true, card, perSurface: { chat: false } }, 'chat')).toBe(false);
    expect(voiceActiveFor({ enabled: true, card }, 'chat')).toBe(true);
  });

  it('renders an empty string when inactive (so callers can append unconditionally)', () => {
    expect(renderVoiceBlock(undefined, 'chat')).toBe('');
    expect(renderVoiceBlock({ enabled: false, card }, 'chat')).toBe('');
    expect(renderVoiceBlock({ enabled: true, card, perSurface: { email: false } }, 'email')).toBe('');
  });

  it('embeds the card inside the delimiters when active', () => {
    const block = renderVoiceBlock({ enabled: true, card }, 'imessage');
    expect(block).toContain("WRITE IN THE USER'S VOICE");
    expect(block).toContain(card);
    expect(block).toContain('<<<USER_VOICE_PROFILE>>>');
    expect(block).toContain('<<<END_USER_VOICE_PROFILE>>>');
  });
});

describe('cleanSamples — de-noise raw sent snippets', () => {
  it('drops empties, bare links, reactions, and dupes (case-insensitive)', () => {
    const out = cleanSamples([
      '  ',
      'Hey there',
      'hey there', // dupe of above once lowercased
      'https://example.com/very/long',
      'Liked "your message"',
      'Loved an image',
      'ok cool',
    ]);
    expect(out).toEqual(['Hey there', 'ok cool']);
  });
});

describe('cleanEmailBody — strip quoted chain & footer', () => {
  it('cuts at an "On … wrote:" quote header', () => {
    const body = "Sounds good, let's do Friday.\n\nOn Mon, Jun 9, 2026, Sam <sam@x.com> wrote:\n> are you free?";
    expect(cleanEmailBody(body)).toBe("Sounds good, let's do Friday.");
  });

  it('cuts at the first quoted ">" line and drops the mobile footer', () => {
    const body = 'yep works for me\n> original question\nSent from my iPhone';
    expect(cleanEmailBody(body)).toBe('yep works for me');
  });
});

describe('parseDrafts — split, strip fences, de-dupe, cap', () => {
  it('splits on the delimiter and caps at count', () => {
    const raw = `option one\n${DRAFT_DELIM}\noption two\n${DRAFT_DELIM}\noption three`;
    expect(parseDrafts(raw, 2)).toEqual(['option one', 'option two']);
  });

  it('falls back to the whole text when no delimiter is present', () => {
    expect(parseDrafts('just one reply', 3)).toEqual(['just one reply']);
  });

  it('strips code fences and de-dupes', () => {
    const raw = '```\nhello\n```' + `\n${DRAFT_DELIM}\nhello`;
    expect(parseDrafts(raw, 3)).toEqual(['hello']);
  });

  it('returns [] for empty input', () => {
    expect(parseDrafts('   ', 3)).toEqual([]);
  });
});
