import { NextResponse } from "next/server";

import { searchPlayers } from "@/server/search/player-repository";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const query = url.searchParams.get("q") ?? "";

  const results = await searchPlayers(query, 8);
  return NextResponse.json({
    results
  });
}
