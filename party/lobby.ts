import type * as Party from "partykit/server";

type LobbyEntry = {
  roomCode: string;
  playerCount: number;
  maxPlayers: number;
  updatedAt: number;
};

const ENTRY_TTL_MS = 2 * 60 * 1000;

export default class LobbyParty implements Party.Server {
  rooms = new Map<string, LobbyEntry>();

  constructor(readonly room: Party.Room) {}

  async onStart() {
    const stored = await this.room.storage.get<LobbyEntry[]>("rooms");
    if (stored) {
      for (const entry of stored) this.rooms.set(entry.roomCode, entry);
    }
  }

  async onRequest(req: Party.Request): Promise<Response> {
    const corsHeaders: Record<string, string> = {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, POST, OPTIONS",
      "access-control-allow-headers": "content-type"
    };

    if (req.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    this.prune();

    if (req.method === "GET") {
      return new Response(JSON.stringify({ rooms: [...this.rooms.values()] }), {
        headers: { "content-type": "application/json", ...corsHeaders }
      });
    }

    if (req.method === "POST") {
      let body: unknown;
      try {
        body = await req.json();
      } catch {
        return new Response("invalid json", { status: 400, headers: corsHeaders });
      }

      const op = body as { type: "upsert"; entry: LobbyEntry } | { type: "remove"; roomCode: string };

      if (op?.type === "upsert" && op.entry?.roomCode) {
        this.rooms.set(op.entry.roomCode, op.entry);
      } else if (op?.type === "remove" && op.roomCode) {
        this.rooms.delete(op.roomCode);
      } else {
        return new Response("invalid body", { status: 400, headers: corsHeaders });
      }

      await this.persist();
      return new Response("ok", { headers: corsHeaders });
    }

    return new Response("method not allowed", { status: 405, headers: corsHeaders });
  }

  private prune() {
    const cutoff = Date.now() - ENTRY_TTL_MS;
    for (const [code, entry] of this.rooms) {
      if (entry.updatedAt < cutoff) {
        this.rooms.delete(code);
      }
    }
  }

  private async persist() {
    await this.room.storage.put("rooms", [...this.rooms.values()]);
  }
}
