import { NextResponse } from "next/server";

import { getPlayerSessionFromCookie } from "@/lib/auth/session-server";
import { RoomActionError, getRoomManager } from "@/server/game/room-manager";

export const runtime = "nodejs";

export async function POST() {
  const session = await getPlayerSessionFromCookie();
  if (!session) {
    return NextResponse.json({ error: "Create a guest session first." }, { status: 401 });
  }

  try {
    const result = await getRoomManager().joinBestRoom(session);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof RoomActionError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }

    return NextResponse.json({ error: "Unable to join a room." }, { status: 500 });
  }
}
