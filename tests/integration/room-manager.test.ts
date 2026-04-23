import { describe, expect, it, vi } from "vitest";

import { type ParticipantTokenPayload, verifySignedToken } from "@/lib/auth/tokens";
import { RoomActionError, RoomManager } from "@/server/game/room-manager";

function createSession(nickname: string, sessionId: string) {
  return {
    sessionId,
    nickname,
    issuedAt: Date.now()
  };
}

describe("room manager integration", () => {
  it("restores the same participant on reconnect and promotes a new host after disconnect", async () => {
    const manager = new RoomManager();
    const host = await manager.createRoom(createSession("Host", "host-reconnect"));
    const guest = await manager.joinRoom(host.roomCode, createSession("Guest", "guest-reconnect"));

    const hostToken = verifySignedToken<ParticipantTokenPayload>(host.participantToken);
    const guestToken = verifySignedToken<ParticipantTokenPayload>(guest.participantToken);
    expect(hostToken).toBeTruthy();
    expect(guestToken).toBeTruthy();

    await manager.watchRoom(host.roomCode, hostToken!, "socket-host");
    await manager.watchRoom(host.roomCode, guestToken!, "socket-guest");
    await manager.handleDisconnect("socket-host");

    const reconnectedGuest = await manager.reconnect(host.roomCode, guestToken!);
    expect(reconnectedGuest.participantId).toBe(guest.participantId);
    expect(reconnectedGuest.snapshot.players.find((player) => player.participantId === guest.participantId)?.isHost).toBe(true);
  });

  it("blocks late joins mid-game but allows reconnecting participants", async () => {
    vi.useFakeTimers();
    const manager = new RoomManager();
    const host = await manager.createRoom(createSession("Host", "host-midgame"));
    const guest = await manager.joinRoom(host.roomCode, createSession("Guest", "guest-midgame"));
    const guestToken = verifySignedToken<ParticipantTokenPayload>(guest.participantToken);

    await manager.startGame(host.roomCode, host.participantId);

    await expect(manager.joinRoom(host.roomCode, createSession("Late", "late-midgame"))).rejects.toMatchObject<Partial<RoomActionError>>({
      code: "ROOM_UNAVAILABLE"
    });

    const reconnected = await manager.reconnect(host.roomCode, guestToken!);
    expect(reconnected.participantId).toBe(guest.participantId);

    vi.useRealTimers();
  });
});
