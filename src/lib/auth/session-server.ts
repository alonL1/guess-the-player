import { cookies } from "next/headers";

import {
  createGuestSession,
  createSignedToken,
  type PlayerSessionPayload,
  verifySignedToken
} from "@/lib/auth/tokens";
import { normalizeSearchText } from "@/lib/utils";

export const PLAYER_SESSION_COOKIE = "playerSession";

export async function getPlayerSessionFromCookie() {
  const store = await cookies();
  const token = store.get(PLAYER_SESSION_COOKIE)?.value;
  return verifySignedToken<PlayerSessionPayload>(token);
}

export async function setGuestSessionCookie(nickname: string) {
  const store = await cookies();
  const existing = verifySignedToken<PlayerSessionPayload>(store.get(PLAYER_SESSION_COOKIE)?.value);
  const payload: PlayerSessionPayload = existing
    ? {
        ...existing,
        nickname,
        issuedAt: Date.now()
      }
    : createGuestSession(nickname);

  store.set(PLAYER_SESSION_COOKIE, createSignedToken(payload), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30
  });

  return payload;
}

export function validateNickname(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const nickname = value.trim();
  const normalized = normalizeSearchText(nickname);
  if (nickname.length < 2 || nickname.length > 20 || !normalized) {
    return null;
  }

  return nickname;
}
