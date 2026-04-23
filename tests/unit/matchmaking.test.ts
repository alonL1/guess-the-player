import { describe, expect, it, vi } from "vitest";

import { RoomActionError, RoomManager } from "@/server/game/room-manager";

function createSession(nickname: string, sessionId: string) {
  return {
    sessionId,
    nickname,
    issuedAt: Date.now()
  };
}

describe("matchmaking and start validation", () => {
  it("joins the fullest eligible public lobby room", async () => {
    vi.useFakeTimers();
    const manager = new RoomManager();

    const roomOne = await manager.createRoom(createSession("Host One", "host-1"));
    await manager.joinRoom(roomOne.roomCode, createSession("Guest One", "guest-1"));

    const roomTwo = await manager.createRoom(createSession("Host Two", "host-2"));
    await manager.joinRoom(roomTwo.roomCode, createSession("Guest Two", "guest-2"));
    await manager.joinRoom(roomTwo.roomCode, createSession("Guest Three", "guest-3"));

    const roomThree = await manager.createRoom(createSession("Host Three", "host-3"));
    await manager.joinRoom(roomThree.roomCode, createSession("Guest Four", "guest-4"));
    await manager.startGame(roomThree.roomCode, roomThree.participantId);

    const result = await manager.joinBestRoom(createSession("Late Joiner", "late-1"));
    expect(result.roomCode).toBe(roomTwo.roomCode);

    vi.useRealTimers();
  });

  it("blocks starting when the filtered catalog cannot supply enough rounds", async () => {
    const manager = new RoomManager();
    const room = await manager.createRoom(createSession("Host", "host-start"));
    await manager.joinRoom(room.roomCode, createSession("Guest", "guest-start"));

    await manager.updateSettings(room.roomCode, room.participantId, {
      difficulty: ["impossible"],
      roundCount: 10
    });

    await expect(manager.startGame(room.roomCode, room.participantId)).rejects.toMatchObject<Partial<RoomActionError>>({
      code: "VALIDATION_FAILED"
    });
  });
});
