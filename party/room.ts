import type * as Party from "partykit/server";

import { CATALOG, CATALOG_YEAR_RANGE, buildBalancedPlayerDeck, findPlayerById, getEligiblePlayers } from "../src/lib/catalog";
import type { AckResponse, ClientMessage, GuessResult, ServerMessage } from "../src/lib/messages";
import { calculateCurrentCap, calculateScore } from "../src/lib/scoring";
import { POSITION_GROUP_OPTIONS } from "../src/lib/positions";
import { DEFAULT_ROOM_SETTINGS } from "../src/lib/settings";
import type {
  LeaveIntent,
  PlayerCatalogEntry,
  RoomClosedReason,
  RoomPlayer,
  RoomSettings,
  RoomSnapshot,
  RoomStatus,
  RoundResult,
  TeamId
} from "../src/lib/types";

const COUNTDOWN_MS = 3000;
const EMPTY_ROOM_SWEEP_MS = 60_000;
const STALE_LOBBY_SWEEP_MS = 30 * 60_000;
const MAX_LIFETIME_MS = 4 * 60 * 60_000;
const VALID_TEAM_IDS = new Set<TeamId>([
  "ARI",
  "ATL",
  "BAL",
  "BUF",
  "CAR",
  "CHI",
  "CIN",
  "CLE",
  "DAL",
  "DEN",
  "DET",
  "GB",
  "HOU",
  "IND",
  "JAX",
  "KC",
  "LAC",
  "LAR",
  "LV",
  "MIA",
  "MIN",
  "NE",
  "NO",
  "NYG",
  "NYJ",
  "PHI",
  "PIT",
  "SEA",
  "SF",
  "TB",
  "TEN",
  "WAS"
]);

type ParticipantRecord = {
  id: string;
  sessionId: string;
  nickname: string;
  joinedAt: number;
  score: number;
  connected: boolean;
  connectionIds: Set<string>;
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

// Slim per-round record kept for the whole match (hydrated to full players only
// in the finished snapshot) so the end-of-game summary survives reconnects.
type RoundHistoryRecord = {
  playerId: string;
  roundScores: Record<string, number>;
  correctOrder: string[];
  endedBecause: RoundResult["endedBecause"];
};

type AlarmType =
  | "countdownEnd"
  | "roundEnd"
  | "emptyRoomSweep"
  | "staleLobbySweep"
  | "maxLifetimeCap";

type AlarmEntry = {
  type: AlarmType;
  firesAt: number;
};

type LobbyEntry = {
  roomCode: string;
  playerCount: number;
  maxPlayers: number;
  hostConnected: boolean;
  updatedAt: number;
};

function normalizeRoomCode(id: string) {
  return id.toUpperCase();
}

function sortByJoin(participants: Iterable<ParticipantRecord>) {
  return [...participants].sort((a, b) => a.joinedAt - b.joinedAt);
}

function getPlayerFilters(
  settings: Pick<RoomSettings, "careerYearMode" | "careerStartYear" | "careerEndYear" | "teamId" | "positionGroup">
) {
  return {
    careerYearMode: settings.careerYearMode,
    careerStartYear: settings.careerStartYear,
    careerEndYear: settings.careerEndYear,
    teamId: settings.teamId,
    positionGroup: settings.positionGroup
  };
}

function normalizeSettings(settings: RoomSettings): RoomSettings {
  const careerStartYear = Math.min(Math.max(settings.careerStartYear, CATALOG_YEAR_RANGE.min), CATALOG_YEAR_RANGE.max);
  const shouldMigrateDefaultCurrentYear =
    settings.careerYearMode === "full_career" &&
    careerStartYear === DEFAULT_ROOM_SETTINGS.careerStartYear &&
    settings.careerEndYear >= CATALOG_YEAR_RANGE.max - 1;
  const rawCareerEndYear = shouldMigrateDefaultCurrentYear ? CATALOG_YEAR_RANGE.max : settings.careerEndYear;
  const careerEndYear = Math.min(Math.max(rawCareerEndYear, careerStartYear), CATALOG_YEAR_RANGE.max);
  return {
    ...settings,
    careerStartYear,
    careerEndYear
  };
}

export default class RoomParty implements Party.Server {
  // Persisted to storage so the room survives hibernation
  settings: RoomSettings = { ...DEFAULT_ROOM_SETTINGS };
  status: RoomStatus = "lobby";
  hostParticipantId: string | null = null;
  participants = new Map<string, ParticipantRecord>();
  usedPlayerIds: string[] = [];
  playerDeckIds: string[] = [];
  roundsPlayed = 0;
  currentRound: ActiveRoundRecord | null = null;
  roundHistory: RoundHistoryRecord[] = [];
  cachedPlayers = new Map<string, PlayerCatalogEntry>();
  canStart = false;
  createdAt = 0;
  lastActivityAt = 0;

  readonly roomCode: string;

  constructor(readonly room: Party.Room) {
    this.roomCode = normalizeRoomCode(room.id);
  }

  async onStart() {
    // Rehydrate state from storage on wake from hibernation
    const saved = await this.room.storage.get<SerializedState>("state");
    if (saved) {
      this.settings = normalizeSettings({ ...DEFAULT_ROOM_SETTINGS, ...saved.settings });
      this.status = saved.status;
      this.hostParticipantId = saved.hostParticipantId;
      this.usedPlayerIds = saved.usedPlayerIds;
      this.playerDeckIds = saved.playerDeckIds ?? [];
      this.roundsPlayed = saved.roundsPlayed;
      this.currentRound = saved.currentRound;
      this.roundHistory = saved.roundHistory ?? [];
      this.canStart = saved.canStart;
      this.createdAt = saved.createdAt;
      this.lastActivityAt = saved.lastActivityAt;
      this.participants = new Map(
        saved.participants.map((p) => [
          p.id,
          {
            ...p,
            connected: false, // will be repopulated as sockets reattach
            connectionIds: new Set<string>()
          }
        ])
      );
      for (const id of saved.cachedPlayerIds) {
        const player = findPlayerById(id);
        if (player) this.cachedPlayers.set(player.id, player);
      }
    } else {
      this.settings = normalizeSettings(this.settings);
    }

    // Ensure max-lifetime alarm is in the queue once we have a createdAt
    if (this.createdAt > 0) {
      await this.ensureAlarm("maxLifetimeCap", this.createdAt + MAX_LIFETIME_MS);
    }
  }

  async onConnect(conn: Party.Connection, ctx: Party.ConnectionContext) {
    const url = new URL(ctx.request.url);
    const sessionId = url.searchParams.get("sessionId") ?? "";
    const nickname = (url.searchParams.get("nickname") ?? "Guest").slice(0, 24);
    const requestedParticipantId = url.searchParams.get("participantId") ?? "";

    if (!sessionId) {
      conn.send(this.encode({ type: "error", error: "Missing sessionId" }));
      conn.close();
      return;
    }

    if (this.createdAt === 0) {
      this.createdAt = Date.now();
      await this.ensureAlarm("maxLifetimeCap", this.createdAt + MAX_LIFETIME_MS);
    }
    this.touchActivity();

    // Find by participantId (reconnect) or by sessionId (lobby rejoin same session)
    let participant: ParticipantRecord | undefined;
    if (requestedParticipantId) {
      const candidate = this.participants.get(requestedParticipantId);
      if (candidate && candidate.sessionId === sessionId) {
        participant = candidate;
      }
    }
    if (!participant) {
      participant = [...this.participants.values()].find((p) => p.sessionId === sessionId);
    }

    if (participant) {
      participant.nickname = nickname;
      participant.connected = true;
      participant.connectionIds.add(conn.id);
    } else {
      // New participant — only allowed in lobby
      if (this.status !== "lobby") {
        conn.send(this.encode({ type: "error", error: "This room is already in a game" }));
        conn.close();
        return;
      }
      if (this.participants.size >= this.settings.maxPlayers) {
        conn.send(this.encode({ type: "error", error: "This room is full" }));
        conn.close();
        return;
      }
      participant = {
        id: crypto.randomUUID(),
        sessionId,
        nickname,
        joinedAt: Date.now(),
        score: 0,
        connected: true,
        connectionIds: new Set([conn.id]),
        answeredCorrectly: false,
        wrongGuessCount: 0,
        roundScore: null
      };
      this.participants.set(participant.id, participant);
      if (!this.hostParticipantId) {
        this.hostParticipantId = participant.id;
      }
    }

    conn.setState({ participantId: participant.id });

    await this.refreshCanStart();

    // Send identity + initial snapshot to this connection and update everyone
    // else BEFORE the storage-backed work, so a joining/reconnecting client (and
    // the rest of the room) sees current state without waiting on disk I/O.
    conn.send(JSON.stringify({ type: "hello", participantId: participant.id }));
    conn.send(this.encode({ type: "snapshot", snapshot: this.serialize() }));
    this.broadcastSnapshot();

    await this.scheduleStaleLobbySweep();
    await this.persist();

    if (this.status === "lobby") {
      void this.notifyLobby("upsert");
    }
  }

  async onMessage(raw: string, conn: Party.Connection) {
    this.touchActivity();
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw) as ClientMessage;
    } catch {
      return;
    }

    const participantId = (conn.state as { participantId?: string } | null)?.participantId;
    if (!participantId) return;
    const participant = this.participants.get(participantId);
    if (!participant) return;

    // Lightweight catch-up: a client that suspects it's stale (reconnected or
    // overran a countdown/round) asks for the current snapshot. No ack, no
    // storage write — just re-send current state to this one connection.
    if (msg.type === "sync") {
      try {
        conn.send(this.encode({ type: "snapshot", snapshot: this.serialize() }));
      } catch {
        // connection already closed
      }
      return;
    }

    const requestId = msg.requestId;
    const ack = (response: AckResponse) => {
      if (!requestId) return;
      try {
        conn.send(this.encode({ type: "ack", requestId, response }));
      } catch {
        // Connection already closed (e.g. optimistic leave) — nothing to ack
      }
    };

    try {
      switch (msg.type) {
        case "updateSettings":
          ack({ ok: true, snapshot: await this.handleUpdateSettings(participantId, msg.settings) });
          break;
        case "start":
          ack({ ok: true, snapshot: await this.handleStart(participantId) });
          break;
        case "guess": {
          const result = await this.handleGuess(participantId, msg.playerId);
          conn.send(this.encode({ type: "guessResult", result }));
          ack({ ok: true, result });
          break;
        }
        case "endManual":
          ack({ ok: true, snapshot: await this.handleManualEnd(participantId) });
          break;
        case "continue":
          ack({ ok: true, snapshot: await this.handleContinue(participantId) });
          break;
        case "endGame":
          ack({ ok: true, snapshot: await this.handleEndGame(participantId) });
          break;
        case "leave":
          ack(await this.handleLeave(participantId, msg.intent, conn));
          break;
      }
      await this.persist();
    } catch (error) {
      const err = error as RoomActionError;
      ack({ ok: false, error: err.message ?? "Unknown error", code: err.code });
    }
  }

  async onClose(conn: Party.Connection) {
    const participantId = (conn.state as { participantId?: string } | null)?.participantId;
    if (!participantId) return;
    const participant = this.participants.get(participantId);
    if (!participant) return;

    participant.connectionIds.delete(conn.id);
    participant.connected = participant.connectionIds.size > 0;

    if (!participant.connected && this.hostParticipantId === participant.id) {
      this.promoteNextHost(participant.id);
    }

    // Kahoot: if everyone connected has answered, end the round
    if (this.status === "round_active" && this.settings.mode === "kahoot") {
      const connected = [...this.participants.values()].filter((p) => p.connected);
      const allCorrect = connected.length > 0 && connected.every((p) => p.answeredCorrectly);
      if (allCorrect) {
        await this.endRound("all_correct");
        await this.persist();
        return;
      }
    }

    await this.refreshCanStart();
    this.broadcastSnapshot();
    await this.scheduleEmptyRoomSweepIfNeeded();
    await this.persist();

    if (this.status === "lobby") {
      void this.notifyLobby("upsert");
    }
  }

  async onAlarm() {
    const now = Date.now();
    const queue = (await this.room.storage.get<AlarmEntry[]>("alarmQueue")) ?? [];
    const due = queue.filter((entry) => entry.firesAt <= now);
    const remaining = queue.filter((entry) => entry.firesAt > now);
    await this.room.storage.put("alarmQueue", remaining);

    for (const entry of due) {
      switch (entry.type) {
        case "countdownEnd":
          await this.startRound();
          break;
        case "roundEnd":
          await this.endRound("timer");
          break;
        case "emptyRoomSweep":
          await this.maybeCloseEmptyRoom();
          break;
        case "staleLobbySweep":
          await this.maybeCloseStaleLobby();
          break;
        case "maxLifetimeCap":
          await this.closeRoom("max_lifetime");
          return;
      }
    }

    await this.rescheduleNextAlarm();
    await this.persist();
  }

  // ---- handlers (port of RoomManager methods) ----

  private async handleUpdateSettings(participantId: string, next: Partial<RoomSettings>): Promise<RoomSnapshot> {
    this.assertHost(participantId);
    if (this.status !== "lobby") {
      throw new RoomActionError("INVALID_STATE", "Settings can only be changed in the lobby");
    }
    const merged: RoomSettings = {
      ...DEFAULT_ROOM_SETTINGS,
      ...this.settings,
      ...next,
      difficulty: next.difficulty ?? this.settings.difficulty
    };
    const normalized = normalizeSettings(merged);
    if (merged.roundCount < 1 || merged.roundCount > 20) {
      throw new RoomActionError("VALIDATION_FAILED", "Round count must be between 1 and 20");
    }
    if (merged.timePerRoundSeconds !== null && (merged.timePerRoundSeconds < 5 || merged.timePerRoundSeconds > 120)) {
      throw new RoomActionError("VALIDATION_FAILED", "Timer must be between 5 and 120 seconds or disabled");
    }
    if (merged.maxPlayers < 2 || merged.maxPlayers > 8) {
      throw new RoomActionError("VALIDATION_FAILED", "Max players must be between 2 and 8");
    }
    if (merged.difficulty.length === 0) {
      throw new RoomActionError("VALIDATION_FAILED", "Select at least one difficulty");
    }
    if (!["entered", "retired", "full_career", "current"].includes(merged.careerYearMode)) {
      throw new RoomActionError("VALIDATION_FAILED", "Select a valid year filter");
    }
    if (normalized.careerStartYear > normalized.careerEndYear) {
      throw new RoomActionError("VALIDATION_FAILED", "Career start year must be before career end year");
    }
    if (merged.teamId !== "all" && !VALID_TEAM_IDS.has(merged.teamId)) {
      throw new RoomActionError("VALIDATION_FAILED", "Select a valid team");
    }
    if (!POSITION_GROUP_OPTIONS.includes(merged.positionGroup)) {
      throw new RoomActionError("VALIDATION_FAILED", "Select a valid position group");
    }
    if (this.participants.size > merged.maxPlayers) {
      throw new RoomActionError("VALIDATION_FAILED", "Current player count exceeds the selected max player limit");
    }

    this.settings = normalized;
    await this.refreshCanStart();
    await this.scheduleStaleLobbySweep();
    this.broadcastSnapshot();
    void this.notifyLobby("upsert");
    return this.serialize();
  }

  private async handleStart(participantId: string): Promise<RoomSnapshot> {
    this.assertHost(participantId);
    if (this.status !== "lobby") {
      throw new RoomActionError("INVALID_STATE", "This room is not in the lobby");
    }
    await this.refreshCanStart();
    if (!this.canStart) {
      throw new RoomActionError(
        "VALIDATION_FAILED",
        "This room does not have enough eligible players or active participants to start"
      );
    }

    this.usedPlayerIds = [];
    this.playerDeckIds = buildBalancedPlayerDeck(
      this.settings.difficulty,
      this.settings.roundCount,
      getPlayerFilters(this.settings)
    ).map((player) => player.id);
    this.roundsPlayed = 0;
    this.currentRound = null;
    this.roundHistory = [];
    for (const p of this.participants.values()) {
      p.score = 0;
      this.resetParticipantRoundState(p);
    }
    await this.beginCountdown();
    void this.notifyLobby("remove");
    return this.serialize();
  }

  private async handleGuess(participantId: string, guessedPlayerId: string): Promise<GuessResult> {
    const participant = this.requireParticipant(participantId);
    const round = this.currentRound;
    if (this.status !== "round_active" || !round || !round.playerId || !round.startedAt) {
      throw new RoomActionError("INVALID_STATE", "There is no active round right now");
    }

    if (participant.answeredCorrectly) {
      return {
        status: "duplicate",
        message: "You already answered this round",
        currentCap: calculateCurrentCap(participant.wrongGuessCount)
      };
    }

    if (round.playerId !== guessedPlayerId) {
      participant.wrongGuessCount += 1;
      this.broadcastSnapshot();
      return {
        status: "wrong",
        message: "Wrong guess. Keep going",
        currentCap: calculateCurrentCap(participant.wrongGuessCount)
      };
    }

    participant.answeredCorrectly = true;
    const correctOrder = round.correctOrder.length + 1;
    round.correctOrder.push(participant.id);

    let score = 1000;
    if (this.settings.mode === "kahoot") {
      const remainingFraction =
        this.settings.timePerRoundSeconds && round.endsAt
          ? Math.max(0, (round.endsAt - Date.now()) / (this.settings.timePerRoundSeconds * 1000))
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

    if (this.settings.mode === "sudden_death") {
      await this.endRound("first_correct");
    } else {
      const connected = [...this.participants.values()].filter((p) => p.connected);
      const allCorrect = connected.length > 0 && connected.every((p) => p.answeredCorrectly);
      if (allCorrect) {
        await this.endRound("all_correct");
      } else {
        this.broadcastSnapshot();
      }
    }

    return { status: "correct", message: "Correct", score };
  }

  private async handleManualEnd(participantId: string): Promise<RoomSnapshot> {
    this.assertHost(participantId);
    if (this.status !== "round_active") {
      throw new RoomActionError("INVALID_STATE", "No active round is running");
    }
    if (this.settings.timePerRoundSeconds !== null) {
      throw new RoomActionError("INVALID_STATE", "Manual ending is only enabled when the timer is off");
    }
    await this.endRound("manual");
    return this.serialize();
  }

  private async handleContinue(participantId: string): Promise<RoomSnapshot> {
    this.assertHost(participantId);

    if (this.status === "round_reveal") {
      this.status = this.roundsPlayed >= this.settings.roundCount ? "finished" : "round_leaderboard";
      this.broadcastSnapshot();
      return this.serialize();
    }
    if (this.status === "round_leaderboard") {
      await this.beginCountdown();
      return this.serialize();
    }
    if (this.status === "finished") {
      await this.resetToLobby();
      void this.notifyLobby("upsert");
      return this.serialize();
    }
    throw new RoomActionError("INVALID_STATE", "Continue is not available right now");
  }

  // Host aborts the in-progress match and returns everyone to the lobby (room
  // stays open). Distinct from "leave/end_room" which closes the room entirely.
  private async handleEndGame(participantId: string): Promise<RoomSnapshot> {
    this.assertHost(participantId);
    if (this.status === "lobby") {
      throw new RoomActionError("INVALID_STATE", "The game is not in progress");
    }
    await this.clearAlarm("countdownEnd");
    await this.clearAlarm("roundEnd");
    await this.resetToLobby();
    void this.notifyLobby("upsert");
    return this.serialize();
  }

  private async handleLeave(
    participantId: string,
    intent: LeaveIntent,
    _conn: Party.Connection
  ): Promise<AckResponse> {
    const participant = this.requireParticipant(participantId);

    if (intent === "end_room") {
      this.assertHost(participantId);
      await this.closeRoom("host_ended");
      return { ok: true, closed: true, reason: "host_ended" };
    }

    // Remove the participant. Don't close the socket server-side — the client
    // closes its own socket in goHome() after receiving this ack.
    this.participants.delete(participant.id);

    if (this.participants.size === 0) {
      await this.closeRoom("room_empty", false);
      return { ok: true, closed: true, reason: "room_empty" };
    }

    if (this.hostParticipantId === participantId) {
      this.promoteNextHost(participantId);
    }

    await this.refreshCanStart();

    // Kahoot resolution after participant exit
    if (this.status === "round_active" && this.settings.mode === "kahoot") {
      const connected = [...this.participants.values()].filter((p) => p.connected);
      const allCorrect = connected.length > 0 && connected.every((p) => p.answeredCorrectly);
      if (allCorrect) {
        await this.endRound("all_correct");
        return { ok: true, closed: false, reason: null, snapshot: this.serialize() };
      }
    }

    this.broadcastSnapshot();
    if (this.status === "lobby") void this.notifyLobby("upsert");
    return { ok: true, closed: false, reason: null, snapshot: this.serialize() };
  }

  // ---- lifecycle internals ----

  private async beginCountdown() {
    this.status = "countdown";
    for (const p of this.participants.values()) this.resetParticipantRoundState(p);
    this.currentRound = {
      roundNumber: this.roundsPlayed + 1,
      playerId: null,
      countdownEndsAt: Date.now() + COUNTDOWN_MS,
      startedAt: null,
      endsAt: null,
      correctOrder: [],
      roundScores: {},
      endedBecause: null
    };
    this.broadcastSnapshot();
    await this.ensureAlarm("countdownEnd", Date.now() + COUNTDOWN_MS);
  }

  private async startRound() {
    if (!this.currentRound) return;
    const plannedPlayerId = this.playerDeckIds[this.currentRound.roundNumber - 1];
    const plannedPlayer = plannedPlayerId ? findPlayerById(plannedPlayerId) : null;
    const candidates = plannedPlayer
      ? [plannedPlayer]
      : getEligiblePlayers(this.settings.difficulty, this.usedPlayerIds, getPlayerFilters(this.settings));
    if (candidates.length === 0) {
      this.status = "finished";
      this.broadcastSnapshot();
      return;
    }
    const picked = candidates[Math.floor(Math.random() * candidates.length)];
    this.cachedPlayers.set(picked.id, picked);
    this.usedPlayerIds.push(picked.id);
    this.status = "round_active";
    this.currentRound.playerId = picked.id;
    this.currentRound.countdownEndsAt = null;
    this.currentRound.startedAt = Date.now();
    this.currentRound.endsAt =
      this.settings.timePerRoundSeconds === null
        ? null
        : this.currentRound.startedAt + this.settings.timePerRoundSeconds * 1000;

    this.broadcastSnapshot();

    if (this.currentRound.endsAt) {
      await this.ensureAlarm("roundEnd", this.currentRound.endsAt);
    }
  }

  private async endRound(endedBecause: RoundResult["endedBecause"]) {
    if (!this.currentRound || !this.currentRound.playerId) return;
    this.currentRound.endedBecause = endedBecause;
    this.roundsPlayed = this.currentRound.roundNumber;
    for (const p of this.participants.values()) {
      if (p.roundScore === null) p.roundScore = 0;
    }

    // Record this round for the end-of-game summary / "sickest pull".
    const completedRoundScores: Record<string, number> = {};
    for (const p of this.participants.values()) completedRoundScores[p.id] = p.roundScore ?? 0;
    this.roundHistory.push({
      playerId: this.currentRound.playerId,
      roundScores: completedRoundScores,
      correctOrder: [...this.currentRound.correctOrder],
      endedBecause
    });

    this.status = "round_reveal";
    // Broadcast first so every client flips to the reveal immediately; the
    // storage-backed alarm clear can happen after. A stray roundEnd alarm that
    // fires before the clear lands is harmless — endRound re-runs idempotently.
    this.broadcastSnapshot();
    await this.clearAlarm("roundEnd");
  }

  private async resetToLobby() {
    this.status = "lobby";
    this.roundsPlayed = 0;
    this.usedPlayerIds = [];
    this.playerDeckIds = [];
    this.currentRound = null;
    this.roundHistory = [];
    for (const p of this.participants.values()) {
      p.score = 0;
      this.resetParticipantRoundState(p);
    }
    await this.refreshCanStart();
    // Broadcast the lobby reset first; the stale-lobby sweep (storage) can follow.
    this.broadcastSnapshot();
    await this.scheduleStaleLobbySweep();
  }

  private resetParticipantRoundState(p: ParticipantRecord) {
    p.answeredCorrectly = false;
    p.wrongGuessCount = 0;
    p.roundScore = null;
  }

  private promoteNextHost(previousHostId: string) {
    const ordered = sortByJoin(this.participants.values()).filter((p) => p.id !== previousHostId);
    const next = ordered.find((p) => p.connected) ?? ordered[0];
    if (!next) return;
    this.hostParticipantId = next.id;
  }

  private assertHost(participantId: string) {
    if (this.hostParticipantId !== participantId) {
      throw new RoomActionError("NOT_HOST", "Only the host can do that");
    }
  }

  private requireParticipant(participantId: string) {
    const p = this.participants.get(participantId);
    if (!p) throw new RoomActionError("UNAUTHORIZED", "Participant is not part of this room");
    return p;
  }

  private async refreshCanStart() {
    if (this.status !== "lobby") {
      this.canStart = false;
      return;
    }
    if (this.participants.size < 2) {
      this.canStart = false;
      return;
    }
    const deck = buildBalancedPlayerDeck(this.settings.difficulty, this.settings.roundCount, getPlayerFilters(this.settings));
    this.canStart = deck.length >= this.settings.roundCount;
  }

  // ---- alarm queue ----

  private async ensureAlarm(type: AlarmType, firesAt: number) {
    const queue = (await this.room.storage.get<AlarmEntry[]>("alarmQueue")) ?? [];
    const filtered = queue.filter((e) => e.type !== type);
    filtered.push({ type, firesAt });
    await this.room.storage.put("alarmQueue", filtered);
    await this.rescheduleNextAlarm(filtered);
  }

  private async clearAlarm(type: AlarmType) {
    const queue = (await this.room.storage.get<AlarmEntry[]>("alarmQueue")) ?? [];
    const filtered = queue.filter((e) => e.type !== type);
    await this.room.storage.put("alarmQueue", filtered);
    await this.rescheduleNextAlarm(filtered);
  }

  private async rescheduleNextAlarm(queue?: AlarmEntry[]) {
    const items = queue ?? (await this.room.storage.get<AlarmEntry[]>("alarmQueue")) ?? [];
    if (items.length === 0) {
      await this.room.storage.deleteAlarm();
      return;
    }
    const soonest = Math.min(...items.map((e) => e.firesAt));
    await this.room.storage.setAlarm(soonest);
  }

  private async scheduleEmptyRoomSweepIfNeeded() {
    const anyConnected = [...this.participants.values()].some((p) => p.connected);
    if (!anyConnected) {
      await this.ensureAlarm("emptyRoomSweep", Date.now() + EMPTY_ROOM_SWEEP_MS);
    }
  }

  private async scheduleStaleLobbySweep() {
    if (this.status === "lobby") {
      await this.ensureAlarm("staleLobbySweep", this.lastActivityAt + STALE_LOBBY_SWEEP_MS);
    } else {
      await this.clearAlarm("staleLobbySweep");
    }
  }

  private async maybeCloseEmptyRoom() {
    const anyConnected = [...this.participants.values()].some((p) => p.connected);
    if (!anyConnected) {
      await this.closeRoom("room_empty", false);
    }
  }

  private async maybeCloseStaleLobby() {
    if (this.status === "lobby" && Date.now() - this.lastActivityAt >= STALE_LOBBY_SWEEP_MS) {
      await this.closeRoom("idle_timeout");
    }
  }

  private async closeRoom(reason: RoomClosedReason, notifyParticipants = true) {
    if (notifyParticipants) {
      this.room.broadcast(this.encode({ type: "closed", reason }));
    }
    this.participants.clear();
    this.hostParticipantId = null;
    this.status = "lobby";
    this.currentRound = null;
    this.usedPlayerIds = [];
    this.playerDeckIds = [];
    this.roundsPlayed = 0;
    // Don't close connections server-side — clients react to the "closed" event
    // (or the leave-ack) and close their own sockets via goHome(). Server-side
    // close before flushing the broadcast/ack can race and cut clients off.
    await this.room.storage.deleteAll();
    void this.notifyLobby("remove");
  }

  private touchActivity() {
    this.lastActivityAt = Date.now();
  }

  // ---- serialization & broadcast ----

  private serialize(): RoomSnapshot {
    const reveal =
      this.currentRound?.playerId &&
      (this.status === "round_reveal" || this.status === "round_leaderboard" || this.status === "finished")
        ? this.buildRoundResult()
        : null;

    // Only ship the full round history (hydrated to full players) at game over,
    // to keep mid-game snapshots lean.
    const roundHistory =
      this.status === "finished"
        ? this.roundHistory
            .map((record): RoundResult | null => {
              const player = this.cachedPlayers.get(record.playerId) ?? findPlayerById(record.playerId);
              if (!player) return null;
              return {
                player,
                roundScores: record.roundScores,
                correctOrder: record.correctOrder,
                endedBecause: record.endedBecause
              };
            })
            .filter((entry): entry is RoundResult => entry !== null)
        : undefined;

    return {
      roomCode: this.roomCode,
      status: this.status,
      settings: this.settings,
      inviteUrl: `/rooms/${this.roomCode}`,
      players: sortByJoin(this.participants.values()).map((p) => this.toPlayerView(p)),
      round: this.currentRound
        ? {
            roundNumber: this.currentRound.roundNumber,
            totalRounds: this.settings.roundCount,
            countdownEndsAt: this.currentRound.countdownEndsAt
              ? new Date(this.currentRound.countdownEndsAt).toISOString()
              : null,
            startedAt: this.currentRound.startedAt ? new Date(this.currentRound.startedAt).toISOString() : null,
            endsAt: this.currentRound.endsAt ? new Date(this.currentRound.endsAt).toISOString() : null,
            position:
              this.currentRound.playerId && this.settings.showPosition && this.status !== "countdown"
                ? this.cachedPlayers.get(this.currentRound.playerId)?.position ?? null
                : null,
            teamStints:
              this.currentRound.playerId && this.status !== "countdown"
                ? this.cachedPlayers.get(this.currentRound.playerId)?.teamStints ?? []
                : [],
            reveal
          }
        : null,
      canStart: this.canStart,
      roundsPlayed: this.roundsPlayed,
      roundHistory
    };
  }

  private buildRoundResult(): RoundResult | null {
    const round = this.currentRound;
    if (!round?.playerId || !round.endedBecause) return null;
    const player = this.cachedPlayers.get(round.playerId);
    if (!player) return null;
    const roundScores: Record<string, number> = {};
    for (const p of this.participants.values()) {
      roundScores[p.id] = p.roundScore ?? 0;
    }
    return {
      player,
      roundScores,
      correctOrder: [...round.correctOrder],
      endedBecause: round.endedBecause
    };
  }

  private toPlayerView(p: ParticipantRecord): RoomPlayer {
    return {
      participantId: p.id,
      sessionId: p.sessionId,
      nickname: p.nickname,
      score: p.score,
      connected: p.connected,
      isHost: this.hostParticipantId === p.id,
      joinedAt: new Date(p.joinedAt).toISOString(),
      answeredCorrectly: p.answeredCorrectly,
      wrongGuessCount: p.wrongGuessCount,
      roundScore: p.roundScore
    };
  }

  private broadcastSnapshot() {
    this.room.broadcast(this.encode({ type: "snapshot", snapshot: this.serialize() }));
  }

  private encode(msg: ServerMessage) {
    return JSON.stringify(msg);
  }

  // ---- lobby registry coupling ----

  private async notifyLobby(action: "upsert" | "remove") {
    try {
      const lobby = this.room.context.parties.lobby.get("global");
      if (action === "upsert") {
        const host = this.hostParticipantId ? this.participants.get(this.hostParticipantId) : null;
        const entry: LobbyEntry = {
          roomCode: this.roomCode,
          playerCount: [...this.participants.values()].filter((p) => p.connected).length,
          maxPlayers: this.settings.maxPlayers,
          hostConnected: Boolean(host?.connected),
          updatedAt: Date.now()
        };
        await lobby.fetch({
          method: "POST",
          body: JSON.stringify({ type: "upsert", entry })
        });
      } else {
        await lobby.fetch({
          method: "POST",
          body: JSON.stringify({ type: "remove", roomCode: this.roomCode })
        });
      }
    } catch {
      // Lobby notify failures are non-fatal
    }
  }

  // ---- persistence ----

  private async persist() {
    const serialized: SerializedState = {
      settings: this.settings,
      status: this.status,
      hostParticipantId: this.hostParticipantId,
      participants: [...this.participants.values()].map((p) => ({
        id: p.id,
        sessionId: p.sessionId,
        nickname: p.nickname,
        joinedAt: p.joinedAt,
        score: p.score,
        answeredCorrectly: p.answeredCorrectly,
        wrongGuessCount: p.wrongGuessCount,
        roundScore: p.roundScore
      })),
      usedPlayerIds: this.usedPlayerIds,
      playerDeckIds: this.playerDeckIds,
      roundsPlayed: this.roundsPlayed,
      currentRound: this.currentRound,
      roundHistory: this.roundHistory,
      cachedPlayerIds: [...this.cachedPlayers.keys()],
      canStart: this.canStart,
      createdAt: this.createdAt,
      lastActivityAt: this.lastActivityAt
    };
    await this.room.storage.put("state", serialized);
  }
}

type SerializedParticipant = {
  id: string;
  sessionId: string;
  nickname: string;
  joinedAt: number;
  score: number;
  answeredCorrectly: boolean;
  wrongGuessCount: number;
  roundScore: number | null;
};

type SerializedState = {
  settings: RoomSettings;
  status: RoomStatus;
  hostParticipantId: string | null;
  participants: SerializedParticipant[];
  usedPlayerIds: string[];
  playerDeckIds?: string[];
  roundsPlayed: number;
  currentRound: ActiveRoundRecord | null;
  roundHistory?: RoundHistoryRecord[];
  cachedPlayerIds: string[];
  canStart: boolean;
  createdAt: number;
  lastActivityAt: number;
};

class RoomActionError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

// Suppress unused warning for CATALOG import (used implicitly via getEligiblePlayers/findPlayerById)
void CATALOG;
