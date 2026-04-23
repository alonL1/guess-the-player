import { NextResponse } from "next/server";

import { type ParticipantTokenPayload, verifySignedToken } from "@/lib/auth/tokens";
import { RoomActionError, getRoomManager } from "@/server/game/room-manager";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ code: string }> }) {
  const body = (await request.json().catch(() => null)) as { participantToken?: string } | null;
  const payload = verifySignedToken<ParticipantTokenPayload>(body?.participantToken);

  if (!payload) {
    return NextResponse.json({ error: "Reconnect token is invalid." }, { status: 401 });
  }

  const params = await context.params;
  if (payload.roomCode.toUpperCase() !== params.code.toUpperCase()) {
    return NextResponse.json({ error: "Reconnect token does not belong to this room." }, { status: 401 });
  }

  try {
    const result = await getRoomManager().reconnect(params.code, payload);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof RoomActionError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }

    return NextResponse.json({ error: "Unable to reconnect to room." }, { status: 500 });
  }
}
