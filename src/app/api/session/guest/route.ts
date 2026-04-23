import { NextResponse } from "next/server";

import { setGuestSessionCookie, validateNickname } from "@/lib/auth/session-server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { nickname?: unknown } | null;
  const nickname = validateNickname(body?.nickname);

  if (!nickname) {
    return NextResponse.json(
      {
        error: "Nickname must be between 2 and 20 characters."
      },
      { status: 422 }
    );
  }

  const session = await setGuestSessionCookie(nickname);
  return NextResponse.json({
    nickname: session.nickname
  });
}
