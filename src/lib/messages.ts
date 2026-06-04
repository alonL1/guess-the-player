import type { RoomClosedReason, RoomSettings, RoomSnapshot } from "@/lib/types";

export type GuessResult = {
  status: "wrong" | "correct" | "duplicate";
  message: string;
  currentCap?: number;
  score?: number;
};

export type ClientMessage =
  | { type: "updateSettings"; requestId?: string; settings: Partial<RoomSettings> }
  | { type: "start"; requestId?: string }
  | { type: "guess"; requestId?: string; playerId: string }
  | { type: "endManual"; requestId?: string }
  | { type: "continue"; requestId?: string }
  | { type: "endGame"; requestId?: string }
  | { type: "leave"; requestId?: string; intent: "leave" | "end_room" }
  | { type: "sync" };

export type AckResponse =
  | { ok: true; snapshot?: RoomSnapshot; result?: GuessResult; closed?: boolean; reason?: RoomClosedReason | null }
  | { ok: false; error: string; code?: string };

export type ServerMessage =
  | { type: "snapshot"; snapshot: RoomSnapshot }
  | { type: "guessResult"; result: GuessResult }
  | { type: "closed"; reason: RoomClosedReason }
  | { type: "ack"; requestId: string; response: AckResponse }
  | { type: "error"; error: string };
