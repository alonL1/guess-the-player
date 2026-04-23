import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

const DEFAULT_SECRET = "local-dev-only-secret";

type TokenPayload = Record<string, unknown>;

function getSecret() {
  return process.env.SESSION_SECRET ?? DEFAULT_SECRET;
}

function encode(value: string) {
  return Buffer.from(value).toString("base64url");
}

function decode(value: string) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function signSegment(segment: string) {
  return createHmac("sha256", getSecret()).update(segment).digest("base64url");
}

export function createSignedToken(payload: TokenPayload) {
  const encodedPayload = encode(JSON.stringify(payload));
  const signature = signSegment(encodedPayload);
  return `${encodedPayload}.${signature}`;
}

export function verifySignedToken<T extends TokenPayload>(token: string | undefined | null) {
  if (!token) {
    return null;
  }

  const [encodedPayload, signature] = token.split(".");
  if (!encodedPayload || !signature) {
    return null;
  }

  const expected = signSegment(encodedPayload);
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(signature);

  if (expectedBuffer.length !== actualBuffer.length || !timingSafeEqual(expectedBuffer, actualBuffer)) {
    return null;
  }

  try {
    return JSON.parse(decode(encodedPayload)) as T;
  } catch {
    return null;
  }
}

export type PlayerSessionPayload = {
  sessionId: string;
  nickname: string;
  issuedAt: number;
};

export type ParticipantTokenPayload = {
  participantId: string;
  roomCode: string;
  sessionId: string;
  nickname: string;
  issuedAt: number;
};

export function createGuestSession(nickname: string): PlayerSessionPayload {
  return {
    sessionId: randomUUID(),
    nickname,
    issuedAt: Date.now()
  };
}
