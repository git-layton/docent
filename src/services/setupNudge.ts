// ─── Proactive setup nudge ──────────────────────────────────────────────────────
// Research-backed onboarding nudge. Principles encoded here:
//  • ONE nudge at a time, highest-value gap first — progressive disclosure beats a checklist wall
//    (choice overload / "setup shame" kill completion).
//  • Endowed-progress framing — phrase as "unlock X", not "you failed to do Y".
//  • Respect autonomy — every nudge is dismissible AND has a permanent "don't remind" that we honor
//    forever (a resented nag is worse than no nag; Zeigarnik pull only helps if not resented).
//  • Never on first run — only after onboarding is complete (they JUST did setup).
//  • Actionable — each nudge names the exact place to fix it.

export interface SetupState {
  onboardingComplete: boolean;
  hasUsableModel: boolean;
  mailAccountCount: number;
  screenGranted: boolean | null; // null = unknown/not-yet-checked
  routineCount: number;
  dismissed: string[];           // nudge ids the user permanently dismissed
}

export type NudgeId = 'connect-mail' | 'grant-screen';

export interface SetupNudge {
  id: NudgeId;
  title: string;
  body: string;
  cta: string;
}

// Ordered by value: mail unlocks briefings/watchers (the routines feature); screen unlocks the
// see-your-screen path. Extend by appending — the FIRST eligible, non-dismissed nudge wins.
const CANDIDATES: Array<{ id: NudgeId; eligible: (s: SetupState) => boolean; nudge: SetupNudge }> = [
  {
    id: 'connect-mail',
    eligible: s => s.mailAccountCount === 0,
    nudge: {
      id: 'connect-mail',
      title: 'Unlock daily briefings',
      body: 'Connect a mail account and Alexis can pull together a morning briefing and watch for the emails that matter — with a one-time app password, no web login.',
      cta: 'Connect mail',
    },
  },
  {
    id: 'grant-screen',
    eligible: s => s.screenGranted === false,
    nudge: {
      id: 'grant-screen',
      title: 'Let Alexis see your screen',
      body: 'Grant Screen Recording once and Alexis can read whatever app you\'re looking at — Slack, Mail, a web page — to answer about it.',
      cta: 'Open Mac permissions',
    },
  },
];

/** PURE — the single nudge to show right now, or null. Nothing before onboarding is done, nothing
 *  without a usable model (that's onboarding's job, not a nudge), nothing already dismissed. */
export function pickSetupNudge(s: SetupState): SetupNudge | null {
  if (!s.onboardingComplete || !s.hasUsableModel) return null;
  for (const c of CANDIDATES) {
    if (s.dismissed.includes(c.id)) continue;
    if (c.eligible(s)) return c.nudge;
  }
  return null;
}
