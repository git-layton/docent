// Which agents the mobile companion sees: Docent plus agents the user created.
// The other canned built-ins are desktop utilities — Codey drives the Code
// surface, Forge Guide documents the desktop app, 'f-default' is the hidden
// fallback — and don't belong on the phone.
export function filterMobileAgents(assistants: any[]): any[] {
  return assistants.filter((a: any) => a && (a.id === 'alexis' || !a.isDefault));
}
