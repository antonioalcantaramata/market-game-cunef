// Remembers, on this phone, which team it has in each session, so scanning the
// projector's QR again (or reloading) brings the group back to its own team.

const key = (sessionId: string) => `market-game:team:${sessionId}`;

export function rememberTeam(sessionId: string, code: string) {
  try {
    localStorage.setItem(key(sessionId), code);
  } catch {}
}

export function rememberedTeam(sessionId: string): string | null {
  try {
    return localStorage.getItem(key(sessionId));
  } catch {
    return null;
  }
}
