import { createServer } from "node:http";
import { parse } from "node:url";

import next from "next";
import { Server as SocketIOServer } from "socket.io";

import { type ParticipantTokenPayload, verifySignedToken } from "@/lib/auth/tokens";
import { setSocketServer } from "@/server/game/realtime";
import { RoomActionError, getRoomManager } from "@/server/game/room-manager";

const dev = process.env.NODE_ENV !== "production";
const port = Number(process.env.PORT ?? 3000);
const bindHost = process.env.HOST ?? "0.0.0.0";
const publicAppUrl = process.env.APP_URL ?? `http://localhost:${port}`;

const app = next({
  dev,
  hostname: bindHost,
  port,
  webpack: true
});
const handle = app.getRequestHandler();

function toSocketError(error: unknown) {
  if (error instanceof RoomActionError) {
    return { error: error.message, code: error.code };
  }

  return { error: "Unexpected server error." };
}

void app.prepare().then(() => {
  const manager = getRoomManager();
  const httpServer = createServer(async (request, response) => {
    const parsedUrl = parse(request.url ?? "", true);
    await handle(request, response, parsedUrl);
  });

  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: process.env.APP_URL ?? "http://localhost:3000",
      methods: ["GET", "POST"]
    }
  });

  setSocketServer(io);

  io.on("connection", (socket) => {
    socket.on("room:watch", async (payload: { roomCode?: string; participantToken?: string }, callback?: (response: unknown) => void) => {
      try {
        const token = verifySignedToken<ParticipantTokenPayload>(payload.participantToken);
        if (!token || !payload.roomCode) {
          throw new RoomActionError("UNAUTHORIZED", "A valid participant token is required.", 401);
        }

        const roomCode = payload.roomCode.toUpperCase();
        const snapshot = await manager.watchRoom(roomCode, token, socket.id);
        socket.join(roomCode);
        callback?.({ ok: true, snapshot });
      } catch (error) {
        callback?.({ ok: false, ...toSocketError(error) });
      }
    });

    socket.on(
      "room:updateSettings",
      async (
        payload: { roomCode: string; participantId: string; settings: Record<string, unknown> },
        callback?: (response: unknown) => void
      ) => {
        try {
          const snapshot = await manager.updateSettings(payload.roomCode, payload.participantId, payload.settings);
          callback?.({ ok: true, snapshot });
        } catch (error) {
          callback?.({ ok: false, ...toSocketError(error) });
        }
      }
    );

    socket.on("room:start", async (payload: { roomCode: string; participantId: string }, callback?: (response: unknown) => void) => {
      try {
        const snapshot = await manager.startGame(payload.roomCode, payload.participantId);
        callback?.({ ok: true, snapshot });
      } catch (error) {
        callback?.({ ok: false, ...toSocketError(error) });
      }
    });

    socket.on(
      "round:guess",
      async (
        payload: { roomCode: string; participantId: string; playerId: string },
        callback?: (response: unknown) => void
      ) => {
        try {
          const result = await manager.submitGuess(payload.roomCode, payload.participantId, payload.playerId);
          socket.emit("round:guessResult", result);
          callback?.({ ok: true, result });
        } catch (error) {
          callback?.({ ok: false, ...toSocketError(error) });
        }
      }
    );

    socket.on(
      "round:endManual",
      async (payload: { roomCode: string; participantId: string }, callback?: (response: unknown) => void) => {
        try {
          const snapshot = await manager.manualEndRound(payload.roomCode, payload.participantId);
          callback?.({ ok: true, snapshot });
        } catch (error) {
          callback?.({ ok: false, ...toSocketError(error) });
        }
      }
    );

    socket.on(
      "round:continue",
      async (payload: { roomCode: string; participantId: string }, callback?: (response: unknown) => void) => {
        try {
          const snapshot = await manager.continue(payload.roomCode, payload.participantId);
          callback?.({ ok: true, snapshot });
        } catch (error) {
          callback?.({ ok: false, ...toSocketError(error) });
        }
      }
    );

    socket.on(
      "room:leave",
      async (
        payload: { roomCode: string; participantId: string; intent: "leave" | "end_room" },
        callback?: (response: unknown) => void
      ) => {
        try {
          const result = await manager.leaveRoom(payload.roomCode, payload.participantId, payload.intent);
          socket.leave(payload.roomCode.toUpperCase());
          callback?.({ ok: true, ...result });
        } catch (error) {
          callback?.({ ok: false, ...toSocketError(error) });
        }
      }
    );

    socket.on("disconnect", () => {
      void manager.handleDisconnect(socket.id);
    });
  });

  httpServer.listen(port, bindHost, () => {
    console.log(`> Ready on ${publicAppUrl}`);
  });
});
