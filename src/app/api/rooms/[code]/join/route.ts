import { NextResponse } from "next/server";

import { getPlayerSessionFromCookie } from "@/lib/auth/session-server";
import { RoomActionError, getRoomManager } from "@/server/game/room-manager";

export const runtime = "nodejs";

export async function POST(_request: Request, context: { params: Promise<{ code: string }> }) {
  const session = await getPlayerSessionFromCookie();
  if (!session) {
    return NextResponse.json({ error: "Create a guest session first." }, { status: 401 });
  }

  try {
    const params = await context.params;
    const result = await getRoomManager().joinRoom(params.code, session);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof RoomActionError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }

    return NextResponse.json({ error: "Unable to join room." }, { status: 500 });
  }
}
