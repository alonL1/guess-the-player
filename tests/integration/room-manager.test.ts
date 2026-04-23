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

    await expect(manager.joinRoom(host.roomCode, createSession("Late", "late-midgame"))).rejects.toMatchObject({
      code: "ROOM_UNAVAILABLE"
    });

    const reconnected = await manager.reconnect(host.roomCode, guestToken!);
    expect(reconnected.participantId).toBe(guest.participantId);

    vi.useRealTimers();
  });

  it("lets the host leave and pass host to the next remaining player", async () => {
    const manager = new RoomManager();
    const host = await manager.createRoom(createSession("Host", "host-pass"));
    const guest = await manager.joinRoom(host.roomCode, createSession("Guest", "guest-pass"));

    const result = await manager.leaveRoom(host.roomCode, host.participantId, "leave");

    expect(result.closed).toBe(false);
    expect(result.snapshot?.players).toHaveLength(1);
    expect(result.snapshot?.players[0]?.participantId).toBe(guest.participantId);
    expect(result.snapshot?.players[0]?.isHost).toBe(true);
  });

  it("closes the room when the host ends the game entirely", async () => {
    const manager = new RoomManager();
    const host = await manager.createRoom(createSession("Host", "host-close"));
    await manager.joinRoom(host.roomCode, createSession("Guest", "guest-close"));

    const result = await manager.leaveRoom(host.roomCode, host.participantId, "end_room");

    expect(result.closed).toBe(true);
    expect(result.reason).toBe("host_ended");
    await expect(manager.joinRoom(host.roomCode, createSession("Late", "late-close"))).rejects.toMatchObject({
      code: "NOT_FOUND"
    });
  });

  it("keeps an active match running when one player leaves and one remains", async () => {
    vi.useFakeTimers();
    const manager = new RoomManager();
    const host = await manager.createRoom(createSession("Host", "host-solo"));
    const guest = await manager.joinRoom(host.roomCode, createSession("Guest", "guest-solo"));

    await manager.startGame(host.roomCode, host.participantId);
    await vi.advanceTimersByTimeAsync(3000);

    const result = await manager.leaveRoom(host.roomCode, guest.participantId, "leave");

    expect(result.closed).toBe(false);
    expect(result.snapshot?.status).toBe("round_active");
    expect(result.snapshot?.players).toHaveLength(1);
    expect(result.snapshot?.players[0]?.participantId).toBe(host.participantId);

    vi.useRealTimers();
  });
});
