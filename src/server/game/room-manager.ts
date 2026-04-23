import { randomUUID } from "node:crypto";

import { createSignedToken, type ParticipantTokenPayload, type PlayerSessionPayload } from "@/lib/auth/tokens";
import { DEFAULT_ROOM_SETTINGS } from "@/lib/game/settings";
import { calculateCurrentCap, calculateScore } from "@/lib/game/scoring";
import type {
  PlayerCatalogEntry,
  RoomPlayer,
  RoomSettings,
  RoomSnapshot,
  RoomStatus,
  RoundResult
} from "@/lib/types";
import { findPlayerById, getEligiblePlayers } from "@/server/search/player-repository";
import { getSocketServer } from "@/server/game/realtime";

type RoomActionErrorCode =
  | "UNAUTHORIZED"
  | "NOT_FOUND"
  | "ROOM_FULL"
  | "ROOM_UNAVAILABLE"
  | "NOT_HOST"
  | "INVALID_STATE"
  | "VALIDATION_FAILED";

export class RoomActionError extends Error {
  constructor(
    readonly code: RoomActionErrorCode,
    message: string,
    readonly status = 400
  ) {
    super(message);
  }
}

type ParticipantRecord = {
  id: string;
  sessionId: string;
  nickname: string;
  joinedAt: number;
  score: number;
  connected: boolean;
  socketIds: Set<string>;
  answeredCorrectly: boolean;
  wrongGuessCount: number;
  roundScore: number | null;
};

type ActiveRoundRecord = {
  roundNumber: number;
  playerId: string | null;
  countdownEndsAt: number | null;
  startedAt: number | null;
  endsAt: number | null;
  correctOrder: string[];
  roundScores: Record<string, number>;
  endedBecause: RoundResult["endedBecause"] | null;
};

type RoomRecord = {
  code: string;
  createdAt: number;
  settings: RoomSettings;
  status: RoomStatus;
  hostParticipantId: string;
  participants: Map<string, ParticipantRecord>;
  usedPlayerIds: string[];
  roundsPlayed: number;
  currentRound: ActiveRoundRecord | null;
  timeoutHandle: NodeJS.Timeout | null;
  canStart: boolean;
};

type JoinResult = {
  roomCode: string;
  participantId: string;
  participantToken: string;
  snapshot: RoomSnapshot;
};

function createRoomCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

function getAppUrl() {
  return process.env.APP_URL ?? "http://localhost:3000";
}

function createParticipantToken(payload: ParticipantTokenPayload) {
  return createSignedToken(payload);
}

function sortParticipantsByJoinOrder(participants: Iterable<ParticipantRecord>) {
  return [...participants].sort((left, right) => left.joinedAt - right.joinedAt);
}

function createPlayerView(room: RoomRecord, participant: ParticipantRecord): RoomPlayer {
  return {
    participantId: participant.id,
    sessionId: participant.sessionId,
    nickname: participant.nickname,
    score: participant.score,
    connected: participant.connected,
    isHost: room.hostParticipantId === participant.id,
    joinedAt: new Date(participant.joinedAt).toISOString(),
    answeredCorrectly: participant.answeredCorrectly,
    wrongGuessCount: participant.wrongGuessCount,
    roundScore: participant.roundScore
  };
}

function clearRoomTimeout(room: RoomRecord) {
  if (room.timeoutHandle) {
    clearTimeout(room.timeoutHandle);
    room.timeoutHandle = null;
  }
}

export class RoomManager {
  private readonly rooms = new Map<string, RoomRecord>();
  private readonly socketIndex = new Map<string, { roomCode: string; participantId: string }>();

  async createRoom(session: PlayerSessionPayload) {
    const roomCode = this.createUniqueRoomCode();
    const participant = this.createParticipant(session);
    const room: RoomRecord = {
      code: roomCode,
      createdAt: Date.now(),
      settings: { ...DEFAULT_ROOM_SETTINGS },
      status: "lobby",
      hostParticipantId: participant.id,
      participants: new Map([[participant.id, participant]]),
      usedPlayerIds: [],
      roundsPlayed: 0,
      currentRound: null,
      timeoutHandle: null,
      canStart: false
    };

    this.rooms.set(roomCode, room);
    await this.refreshCanStart(room);
    this.broadcastSnapshot(room);
    return this.toJoinResult(room, participant);
  }

  async joinBestRoom(session: PlayerSessionPayload) {
    const rooms = [...this.rooms.values()]
      .filter((room) => room.status === "lobby" && room.settings.isPublic && room.participants.size < room.settings.maxPlayers)
      .sort((left, right) => {
        if (left.participants.size !== right.participants.size) {
          return right.participants.size - left.participants.size;
        }
        return left.createdAt - right.createdAt;
      });

    if (rooms.length === 0) {
      throw new RoomActionError("NOT_FOUND", "No open public rooms are available right now.", 404);
    }

    return this.joinRoom(rooms[0].code, session);
  }

  async joinRoom(roomCode: string, session: PlayerSessionPayload) {
    const room = this.requireRoom(roomCode);
    if (room.status !== "lobby") {
      throw new RoomActionError("ROOM_UNAVAILABLE", "This room is already in a game. Only reconnecting players can enter.", 409);
    }

    const existing = [...room.participants.values()].find((participant) => participant.sessionId === session.sessionId);
    if (existing) {
      existing.connected = true;
      existing.nickname = session.nickname;
      await this.refreshCanStart(room);
      this.broadcastSnapshot(room);
      return this.toJoinResult(room, existing);
    }

    if (room.participants.size >= room.settings.maxPlayers) {
      throw new RoomActionError("ROOM_FULL", "This room is full.", 409);
    }

    const participant = this.createParticipant(session);
    room.participants.set(participant.id, participant);
    await this.refreshCanStart(room);
    this.broadcastSnapshot(room);
    return this.toJoinResult(room, participant);
  }

  async reconnect(roomCode: string, payload: ParticipantTokenPayload) {
    const room = this.requireRoom(roomCode);
    if (payload.roomCode.toUpperCase() !== room.code) {
      throw new RoomActionError("UNAUTHORIZED", "Reconnect token is invalid for this room.", 401);
    }
    const participant = room.participants.get(payload.participantId);
    if (!participant || participant.sessionId !== payload.sessionId) {
      throw new RoomActionError("UNAUTHORIZED", "Reconnect token is invalid for this room.", 401);
    }

    participant.nickname = payload.nickname;
    return this.toJoinResult(room, participant);
  }

  async watchRoom(roomCode: string, payload: ParticipantTokenPayload, socketId: string) {
    const room = this.requireRoom(roomCode);
    if (payload.roomCode.toUpperCase() !== room.code) {
      throw new RoomActionError("UNAUTHORIZED", "Socket is not authorized for this room.", 401);
    }
    const participant = room.participants.get(payload.participantId);
    if (!participant || participant.sessionId !== payload.sessionId) {
      throw new RoomActionError("UNAUTHORIZED", "Socket is not authorized for this room.", 401);
    }

    participant.connected = true;
    participant.nickname = payload.nickname;
    participant.socketIds.add(socketId);
    this.socketIndex.set(socketId, { roomCode, participantId: participant.id });
    await this.refreshCanStart(room);
    this.broadcastSnapshot(room);
    return this.serializeRoom(room);
  }

  async updateSettings(roomCode: string, participantId: string, nextSettings: Partial<RoomSettings>) {
    const room = this.requireRoom(roomCode);
    this.assertHost(room, participantId);
    if (room.status !== "lobby") {
      throw new RoomActionError("INVALID_STATE", "Settings can only be changed in the lobby.", 409);
    }

    const merged: RoomSettings = {
      ...room.settings,
      ...nextSettings,
      difficulty: nextSettings.difficulty ?? room.settings.difficulty
    };

    if (merged.roundCount < 1 || merged.roundCount > 20) {
      throw new RoomActionError("VALIDATION_FAILED", "Round count must be between 1 and 20.", 422);
    }

    if (merged.timePerRoundSeconds !== null && (merged.timePerRoundSeconds < 5 || merged.timePerRoundSeconds > 120)) {
      throw new RoomActionError("VALIDATION_FAILED", "Timer must be between 5 and 120 seconds or disabled.", 422);
    }

    if (merged.maxPlayers < 2 || merged.maxPlayers > 8) {
      throw new RoomActionError("VALIDATION_FAILED", "Max players must be between 2 and 8.", 422);
    }

    if (merged.difficulty.length === 0) {
      throw new RoomActionError("VALIDATION_FAILED", "Select at least one difficulty.", 422);
    }

    if (room.participants.size > merged.maxPlayers) {
      throw new RoomActionError("VALIDATION_FAILED", "Current player count exceeds the selected max player limit.", 422);
    }

    room.settings = merged;
    await this.refreshCanStart(room);
    this.broadcastSnapshot(room);
    return this.serializeRoom(room);
  }

  async startGame(roomCode: string, participantId: string) {
    const room = this.requireRoom(roomCode);
    this.assertHost(room, participantId);
    if (room.status !== "lobby") {
      throw new RoomActionError("INVALID_STATE", "This room is not in the lobby.", 409);
    }

    await this.refreshCanStart(room);
    if (!room.canStart) {
      throw new RoomActionError("VALIDATION_FAILED", "This room does not have enough eligible players or active participants to start.", 422);
    }

    room.usedPlayerIds = [];
    room.roundsPlayed = 0;
    room.currentRound = null;
    for (const participant of room.participants.values()) {
      participant.score = 0;
      this.resetParticipantRoundState(participant);
    }

    await this.beginCountdown(room);
    return this.serializeRoom(room);
  }

  async submitGuess(roomCode: string, participantId: string, guessedPlayerId: string) {
    const room = this.requireRoom(roomCode);
    const participant = this.requireParticipant(room, participantId);
    const round = room.currentRound;

    if (room.status !== "round_active" || !round || !round.playerId || !round.startedAt) {
      throw new RoomActionError("INVALID_STATE", "There is no active round right now.", 409);
    }

    if (participant.answeredCorrectly) {
      return {
        status: "duplicate",
        message: "You already answered this round.",
        currentCap: calculateCurrentCap(participant.wrongGuessCount)
      };
    }

    if (round.playerId !== guessedPlayerId) {
      participant.wrongGuessCount += 1;
      this.broadcastSnapshot(room);
      return {
        status: "wrong",
        message: "Wrong guess. Keep going.",
        currentCap: calculateCurrentCap(participant.wrongGuessCount)
      };
    }

    participant.answeredCorrectly = true;
    const correctOrder = round.correctOrder.length + 1;
    round.correctOrder.push(participant.id);

    let score = 1000;
    if (room.settings.mode === "kahoot") {
      const remainingFraction =
        room.settings.timePerRoundSeconds && round.endsAt
          ? Math.max(0, (round.endsAt - Date.now()) / (room.settings.timePerRoundSeconds * 1000))
          : undefined;

      score = calculateScore({
        mode: "kahoot",
        wrongGuessCount: participant.wrongGuessCount,
        remainingTimeFraction: remainingFraction,
        correctOrder
      });
    }

    participant.roundScore = score;
    participant.score += score;
    round.roundScores[participant.id] = score;

    if (room.settings.mode === "sudden_death") {
      await this.endRound(room, "first_correct");
    } else {
      const connectedParticipants = [...room.participants.values()].filter((entry) => entry.connected);
      const everyoneCorrect =
        connectedParticipants.length > 0 && connectedParticipants.every((entry) => entry.answeredCorrectly);

      if (everyoneCorrect) {
        await this.endRound(room, "all_correct");
      } else {
        this.broadcastSnapshot(room);
      }
    }

    return {
      status: "correct",
      message: "Correct.",
      score
    };
  }

  async manualEndRound(roomCode: string, participantId: string) {
    const room = this.requireRoom(roomCode);
    this.assertHost(room, participantId);
    if (room.status !== "round_active") {
      throw new RoomActionError("INVALID_STATE", "No active round is running.", 409);
    }

    if (room.settings.timePerRoundSeconds !== null) {
      throw new RoomActionError("INVALID_STATE", "Manual ending is only enabled when the timer is off.", 409);
    }

    await this.endRound(room, "manual");
    return this.serializeRoom(room);
  }

  async continue(roomCode: string, participantId: string) {
    const room = this.requireRoom(roomCode);
    this.assertHost(room, participantId);

    if (room.status === "round_reveal") {
      room.status = room.roundsPlayed >= room.settings.roundCount ? "finished" : "round_leaderboard";
      this.emitRoom(room.code, "leaderboard:updated", this.serializeRoom(room));
      this.broadcastSnapshot(room);
      return this.serializeRoom(room);
    }

    if (room.status === "round_leaderboard") {
      await this.beginCountdown(room);
      return this.serializeRoom(room);
    }

    if (room.status === "finished") {
      await this.resetToLobby(room);
      return this.serializeRoom(room);
    }

    throw new RoomActionError("INVALID_STATE", "Continue is not available right now.", 409);
  }

  async handleDisconnect(socketId: string) {
    const match = this.socketIndex.get(socketId);
    if (!match) {
      return;
    }

    this.socketIndex.delete(socketId);
    const room = this.rooms.get(match.roomCode);
    if (!room) {
      return;
    }

    const participant = room.participants.get(match.participantId);
    if (!participant) {
      return;
    }

    participant.socketIds.delete(socketId);
    participant.connected = participant.socketIds.size > 0;

    if (!participant.connected && room.hostParticipantId === participant.id) {
      this.promoteNextHost(room, participant.id);
    }

    if (room.status === "round_active" && room.settings.mode === "kahoot") {
      const connectedParticipants = [...room.participants.values()].filter((entry) => entry.connected);
      const everyoneCorrect =
        connectedParticipants.length > 0 && connectedParticipants.every((entry) => entry.answeredCorrectly);
      if (everyoneCorrect) {
        await this.endRound(room, "all_correct");
        return;
      }
    }

    await this.refreshCanStart(room);
    this.broadcastSnapshot(room);
  }

  private createUniqueRoomCode() {
    let roomCode = createRoomCode();
    while (this.rooms.has(roomCode)) {
      roomCode = createRoomCode();
    }
    return roomCode;
  }

  private createParticipant(session: PlayerSessionPayload): ParticipantRecord {
    return {
      id: randomUUID(),
      sessionId: session.sessionId,
      nickname: session.nickname,
      joinedAt: Date.now(),
      score: 0,
      connected: true,
      socketIds: new Set<string>(),
      answeredCorrectly: false,
      wrongGuessCount: 0,
      roundScore: null
    };
  }

  private requireRoom(roomCode: string) {
    const room = this.rooms.get(roomCode.toUpperCase());
    if (!room) {
      throw new RoomActionError("NOT_FOUND", "Room not found.", 404);
    }
    return room;
  }

  private requireParticipant(room: RoomRecord, participantId: string) {
    const participant = room.participants.get(participantId);
    if (!participant) {
      throw new RoomActionError("UNAUTHORIZED", "Participant is not part of this room.", 401);
    }
    return participant;
  }

  private assertHost(room: RoomRecord, participantId: string) {
    if (room.hostParticipantId !== participantId) {
      throw new RoomActionError("NOT_HOST", "Only the host can do that.", 403);
    }
  }

  private async refreshCanStart(room: RoomRecord) {
    if (room.status !== "lobby") {
      room.canStart = false;
      return;
    }

    if (room.participants.size < 2) {
      room.canStart = false;
      return;
    }

    const eligiblePlayers = await getEligiblePlayers(room.settings.difficulty, []);
    room.canStart = eligiblePlayers.length >= room.settings.roundCount;
  }

  private serializeRoom(room: RoomRecord): RoomSnapshot {
    const reveal =
      room.currentRound?.playerId && (room.status === "round_reveal" || room.status === "round_leaderboard" || room.status === "finished")
        ? this.buildRoundResult(room)
        : null;

    return {
      roomCode: room.code,
      status: room.status,
      settings: room.settings,
      inviteUrl: `${getAppUrl()}/rooms/${room.code}`,
      players: sortParticipantsByJoinOrder(room.participants.values()).map((participant) => createPlayerView(room, participant)),
      round: room.currentRound
        ? {
            roundNumber: room.currentRound.roundNumber,
            totalRounds: room.settings.roundCount,
            countdownEndsAt: room.currentRound.countdownEndsAt ? new Date(room.currentRound.countdownEndsAt).toISOString() : null,
            startedAt: room.currentRound.startedAt ? new Date(room.currentRound.startedAt).toISOString() : null,
            endsAt: room.currentRound.endsAt ? new Date(room.currentRound.endsAt).toISOString() : null,
            teamStints:
              room.currentRound.playerId && room.status !== "countdown"
                ? (this.getKnownPlayer(room.currentRound.playerId)?.teamStints ?? [])
                : [],
            reveal
          }
        : null,
      canStart: room.canStart,
      roundsPlayed: room.roundsPlayed
    };
  }

  private buildRoundResult(room: RoomRecord): RoundResult | null {
    const round = room.currentRound;
    if (!round?.playerId || !round.endedBecause) {
      return null;
    }

    const player = this.getKnownPlayer(round.playerId);
    if (!player) {
      return null;
    }

    const roundScores: Record<string, number> = {};
    for (const participant of room.participants.values()) {
      roundScores[participant.id] = participant.roundScore ?? 0;
    }

    return {
      player,
      roundScores,
      correctOrder: [...round.correctOrder],
      endedBecause: round.endedBecause
    };
  }

  private getKnownPlayer(playerId: string) {
    return this.cachedPlayers.get(playerId) ?? null;
  }

  private readonly cachedPlayers = new Map<string, PlayerCatalogEntry>();

  private async beginCountdown(room: RoomRecord) {
    clearRoomTimeout(room);
    room.status = "countdown";
    for (const participant of room.participants.values()) {
      this.resetParticipantRoundState(participant);
    }
    room.currentRound = {
      roundNumber: room.roundsPlayed + 1,
      playerId: null,
      countdownEndsAt: Date.now() + 3000,
      startedAt: null,
      endsAt: null,
      correctOrder: [],
      roundScores: {},
      endedBecause: null
    };

    this.emitRoom(room.code, "game:countdown", this.serializeRoom(room));
    this.broadcastSnapshot(room);

    room.timeoutHandle = setTimeout(() => {
      void this.startRound(room.code);
    }, 3000);
  }

  private async startRound(roomCode: string) {
    const room = this.rooms.get(roomCode);
    if (!room || !room.currentRound) {
      return;
    }

    const candidates = await getEligiblePlayers(room.settings.difficulty, room.usedPlayerIds);
    if (candidates.length === 0) {
      room.status = "finished";
      clearRoomTimeout(room);
      this.emitRoom(room.code, "leaderboard:updated", this.serializeRoom(room));
      this.broadcastSnapshot(room);
      return;
    }

    const selectedPlayer = candidates[Math.floor(Math.random() * candidates.length)];
    this.cachedPlayers.set(selectedPlayer.id, selectedPlayer);

    room.usedPlayerIds.push(selectedPlayer.id);
    room.status = "round_active";
    room.currentRound.playerId = selectedPlayer.id;
    room.currentRound.countdownEndsAt = null;
    room.currentRound.startedAt = Date.now();
    room.currentRound.endsAt =
      room.settings.timePerRoundSeconds === null ? null : room.currentRound.startedAt + room.settings.timePerRoundSeconds * 1000;

    this.emitRoom(room.code, "round:started", this.serializeRoom(room));
    this.broadcastSnapshot(room);

    if (room.currentRound.endsAt) {
      clearRoomTimeout(room);
      const duration = Math.max(0, room.currentRound.endsAt - Date.now());
      room.timeoutHandle = setTimeout(() => {
        void this.endRound(room, "timer");
      }, duration);
    }
  }

  private async endRound(room: RoomRecord, endedBecause: RoundResult["endedBecause"]) {
    if (!room.currentRound || !room.currentRound.playerId) {
      return;
    }

    clearRoomTimeout(room);
    room.currentRound.endedBecause = endedBecause;
    room.roundsPlayed = room.currentRound.roundNumber;

    for (const participant of room.participants.values()) {
      if (participant.roundScore === null) {
        participant.roundScore = 0;
      }
    }

    room.status = "round_reveal";
    this.emitRoom(room.code, "round:ended", this.serializeRoom(room));
    this.broadcastSnapshot(room);
  }

  private async resetToLobby(room: RoomRecord) {
    clearRoomTimeout(room);
    room.status = "lobby";
    room.roundsPlayed = 0;
    room.usedPlayerIds = [];
    room.currentRound = null;
    for (const participant of room.participants.values()) {
      participant.score = 0;
      this.resetParticipantRoundState(participant);
    }
    await this.refreshCanStart(room);
    this.broadcastSnapshot(room);
  }

  private resetParticipantRoundState(participant: ParticipantRecord) {
    participant.answeredCorrectly = false;
    participant.wrongGuessCount = 0;
    participant.roundScore = null;
  }

  private promoteNextHost(room: RoomRecord, previousHostId: string) {
    const nextHost = sortParticipantsByJoinOrder(room.participants.values()).find((participant) => participant.id !== previousHostId);
    if (!nextHost) {
      return;
    }
    room.hostParticipantId = nextHost.id;
    this.emitRoom(room.code, "room:hostChanged", {
      hostParticipantId: nextHost.id
    });
  }

  private toJoinResult(room: RoomRecord, participant: ParticipantRecord): JoinResult {
    const participantToken = createParticipantToken({
      participantId: participant.id,
      roomCode: room.code,
      sessionId: participant.sessionId,
      nickname: participant.nickname,
      issuedAt: Date.now()
    });

    return {
      roomCode: room.code,
      participantId: participant.id,
      participantToken,
      snapshot: this.serializeRoom(room)
    };
  }

  private emitRoom(roomCode: string, event: string, payload: unknown) {
    const io = getSocketServer();
    io?.to(roomCode).emit(event, payload);
  }

  private broadcastSnapshot(room: RoomRecord) {
    this.emitRoom(room.code, "room:snapshot", this.serializeRoom(room));
  }
}

declare global {
  // eslint-disable-next-line no-var
  var __guessThePlayerRoomManager: RoomManager | undefined;
}

export function getRoomManager() {
  if (!globalThis.__guessThePlayerRoomManager) {
    globalThis.__guessThePlayerRoomManager = new RoomManager();
  }

  return globalThis.__guessThePlayerRoomManager;
}
