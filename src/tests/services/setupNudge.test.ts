import { describe, it, expect } from 'vitest';
import { pickSetupNudge, type SetupState } from '../../services/setupNudge';

const base = (over: Partial<SetupState> = {}): SetupState => ({
  onboardingComplete: true,
  hasUsableModel: true,
  mailAccountCount: 0,
  screenGranted: false,
  routineCount: 0,
  dismissed: [],
  ...over,
});

describe('pickSetupNudge', () => {
  it('nothing before onboarding is complete', () => {
    expect(pickSetupNudge(base({ onboardingComplete: false }))).toBeNull();
  });
  it('nothing without a usable model (that is onboarding, not a nudge)', () => {
    expect(pickSetupNudge(base({ hasUsableModel: false }))).toBeNull();
  });
  it('leads with mail (highest value) when nothing set up', () => {
    expect(pickSetupNudge(base())?.id).toBe('connect-mail');
  });
  it('falls through to screen once mail is connected', () => {
    expect(pickSetupNudge(base({ mailAccountCount: 1 }))?.id).toBe('grant-screen');
  });
  it('respects a permanent dismissal and moves to the next gap', () => {
    expect(pickSetupNudge(base({ dismissed: ['connect-mail'] }))?.id).toBe('grant-screen');
  });
  it('null when everything is set up or dismissed', () => {
    expect(pickSetupNudge(base({ mailAccountCount: 2, screenGranted: true }))).toBeNull();
    expect(pickSetupNudge(base({ dismissed: ['connect-mail', 'grant-screen'] }))).toBeNull();
  });
  it('does not nudge for screen while its grant state is still unknown', () => {
    expect(pickSetupNudge(base({ mailAccountCount: 1, screenGranted: null }))).toBeNull();
  });
});
