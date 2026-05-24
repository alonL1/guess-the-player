const SID_KEY = "npg:sessionId";
const NICK_KEY = "npg:nickname";

function tokenKey(roomCode: string) {
  return `npg:participantId:${roomCode}`;
}

export function getOrCreateSessionId(): string {
  if (typeof window === "undefined") return "";
  const existing = localStorage.getItem(SID_KEY);
  if (existing) return existing;
  const id = crypto.randomUUID();
  localStorage.setItem(SID_KEY, id);
  return id;
}

export function getNickname(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem(NICK_KEY) ?? "";
}

export function setNickname(name: string): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(NICK_KEY, name);
}

export function getParticipantId(roomCode: string): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(tokenKey(roomCode));
}

export function setParticipantId(roomCode: string, id: string): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(tokenKey(roomCode), id);
}

export function clearRoomMembership(roomCode: string): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(tokenKey(roomCode));
}
