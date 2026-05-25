import clsx from "clsx";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Link, useNavigate } from "react-router-dom";
import PartySocket from "partysocket";

import { CATALOG_YEAR_RANGE, getEligiblePlayers, searchPlayers as searchPlayersLocal } from "@/lib/catalog";
import type { AckResponse, ClientMessage, GuessResult, ServerMessage } from "@/lib/messages";
import { NFL_TEAMS, formatTeamLabel } from "@/lib/nfl-teams";
import { DEFAULT_ROOM_SETTINGS } from "@/lib/settings";
import {
  clearRoomMembership,
  getNickname,
  getOrCreateSessionId,
  getParticipantId,
  setNickname as persistNickname,
  setParticipantId
} from "@/lib/session";
import type {
  Difficulty,
  CareerYearMode,
  LeaveIntent,
  RoomClosedReason,
  RoomPlayer,
  PlayerSearchResult,
  RoomSettings,
  RoomSnapshot,
  TeamId
} from "@/lib/types";
import { formatYearRange } from "@/lib/utils";

const PARTYKIT_HOST = import.meta.env.VITE_PARTYKIT_HOST || "127.0.0.1:1999";
const DIFFICULTY_OPTIONS: Difficulty[] = ["easy", "medium", "hard", "impossible"];

function buildInviteUrl(roomCode: string) {
  if (typeof window === "undefined") return `/rooms/${roomCode}`;
  return `${window.location.origin}/rooms/${roomCode}`;
}

function getTimerLabel(room: RoomSnapshot | null, now: number | null) {
  if (now === null || !room?.round?.endsAt) return null;
  const remainingMs = new Date(room.round.endsAt).getTime() - now;
  return Math.max(0, Math.ceil(remainingMs / 1000));
}

function getCountdownLabel(room: RoomSnapshot | null, now: number | null) {
  if (now === null || !room?.round?.countdownEndsAt) return null;
  const remainingMs = new Date(room.round.countdownEndsAt).getTime() - now;
  return Math.max(1, Math.ceil(remainingMs / 1000));
}

function sortPlayersForBoard(room: RoomSnapshot | null) {
  if (!room) return [];
  return [...room.players].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.nickname.localeCompare(b.nickname);
  });
}

function formatDelta(points: number) {
  return `${points >= 0 ? "+" : ""}${points}`;
}

function getRoomClosedMessage(reason: RoomClosedReason) {
  if (reason === "host_ended") return "The host ended the game";
  if (reason === "idle_timeout") return "The room was closed for inactivity";
  if (reason === "max_lifetime") return "The room reached its maximum session length";
  return "The room closed";
}

function getRosterStatus(player: RoomPlayer, roomStatus: RoomSnapshot["status"]) {
  if (!player.connected) return "Disconnected";
  if (roomStatus === "round_active") return player.answeredCorrectly ? "Solved" : "Guessing";
  if (roomStatus === "countdown") return "Ready";
  if (roomStatus === "round_reveal") return player.answeredCorrectly ? "Locked in" : "Waiting";
  return "In room";
}

function formatSettingsSummary(settings: RoomSettings): string {
  const timer = settings.timePerRoundSeconds === null ? "No timer" : `${settings.timePerRoundSeconds}s`;
  const difficulties = settings.difficulty.map((d) => d.charAt(0).toUpperCase() + d.slice(1)).join(", ");
  const scoring = settings.mode === "sudden_death" ? "Sudden Death" : "Time Based";
  const team = settings.teamId === "all" ? "All teams" : settings.teamId;
  const yearMode =
    settings.careerYearMode === "entered"
      ? "Entered"
      : settings.careerYearMode === "retired"
        ? "Retired"
        : settings.careerYearMode === "current"
          ? "Current players"
          : "Full career";
  const years = settings.careerYearMode === "current" ? "" : ` ${settings.careerStartYear}-${settings.careerEndYear}`;
  return `${settings.roundCount} rounds · ${timer} · ${scoring} · ${difficulties} · ${yearMode}${years} · ${team}`;
}

function getPlayerFilters(settings: Pick<RoomSettings, "careerYearMode" | "careerStartYear" | "careerEndYear" | "teamId">) {
  return {
    careerYearMode: settings.careerYearMode,
    careerStartYear: settings.careerStartYear,
    careerEndYear: settings.careerEndYear,
    teamId: settings.teamId
  };
}

function YearRangeSlider({
  mode,
  startYear,
  endYear,
  disabled,
  onModeChange,
  onReset,
  onChange
}: {
  mode: CareerYearMode;
  startYear: number;
  endYear: number;
  disabled?: boolean;
  onModeChange: (mode: CareerYearMode) => void;
  onReset: () => void;
  onChange: (next: { careerStartYear: number; careerEndYear: number }) => void;
}) {
  const minYear = CATALOG_YEAR_RANGE.min;
  const maxYear = CATALOG_YEAR_RANGE.max;
  const range = maxYear - minYear;
  const startPercent = ((startYear - minYear) / range) * 100;
  const endPercent = ((endYear - minYear) / range) * 100;
  const yearLabel = `${startYear}-${endYear === maxYear ? "Current" : endYear}`;
  const description =
    mode === "current"
      ? "Only active players in the current catalog are eligible."
      : mode === "entered"
      ? "Only players who entered the league inside this range are eligible."
      : mode === "retired"
        ? "Only players whose final catalog season is inside this range are eligible."
        : "Only players whose full career fits inside this range are eligible.";

  return (
    <div className="rounded-[1.25rem] border border-slate-200 bg-white p-4 text-sm text-slate-700">
      <div className="flex items-center justify-between gap-3">
        <span className="block text-xs uppercase tracking-[0.2em] text-slate-500">Career years</span>
        <button
          type="button"
          disabled={disabled}
          onClick={onReset}
          className="rounded-full border border-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-60"
        >
          Reset
        </button>
      </div>
      <select
        value={mode}
        disabled={disabled}
        onChange={(event) => onModeChange(event.target.value as CareerYearMode)}
        className="mt-3 w-full rounded-[0.9rem] border border-slate-200 bg-slate-50 px-3 py-2 outline-none focus:border-sky-300 disabled:opacity-60"
      >
        <option value="entered">Year Entering League</option>
        <option value="retired">Year Retired</option>
        <option value="full_career">Full Career</option>
        <option value="current">Current Players Only</option>
      </select>
      {mode !== "current" ? (
        <>
          <p className="mt-3 text-xs font-semibold text-slate-700">{yearLabel}</p>
          <div className="year-range-field mt-3">
            <div className="absolute left-0 right-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-slate-200" />
            <div
              className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-sky-500"
              style={{ left: `${startPercent}%`, right: `${100 - endPercent}%` }}
            />
            <input
              type="range"
              min={minYear}
              max={maxYear}
              value={startYear}
              disabled={disabled}
              onChange={(event) => {
                const nextStart = Math.min(Number(event.target.value), endYear);
                onChange({ careerStartYear: nextStart, careerEndYear: endYear });
              }}
              className="year-range-input"
              aria-label="Career start year"
            />
            <input
              type="range"
              min={minYear}
              max={maxYear}
              value={endYear}
              disabled={disabled}
              onChange={(event) => {
                const nextEnd = Math.max(Number(event.target.value), startYear);
                onChange({ careerStartYear: startYear, careerEndYear: nextEnd });
              }}
              className="year-range-input"
              aria-label="Career end year"
            />
          </div>
        </>
      ) : null}
      <p className="mt-3 text-xs leading-5 text-slate-500">{description}</p>
    </div>
  );
}

function ChevronIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M4 6l4 4 4-4" />
    </svg>
  );
}

function PlayerRosterCard({
  room,
  participantId,
  title,
  subtitle
}: {
  room: RoomSnapshot;
  participantId: string;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="glass-panel rounded-[1.5rem] p-3 sm:p-5">
      <div className="flex items-start justify-between gap-2 sm:gap-3">
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500 sm:text-xs">{subtitle}</p>
          <h2 className="mt-1 text-xl font-semibold text-slate-950 sm:mt-2 sm:text-2xl">{title}</h2>
        </div>
        <div className="shrink-0 rounded-full border border-sky-100 bg-sky-50 px-2.5 py-1 text-xs font-medium text-slate-700 sm:px-3 sm:text-sm">
          {room.players.length}/{room.settings.maxPlayers}
        </div>
      </div>

      <div className="mt-4 grid gap-2.5 sm:mt-5 sm:gap-3 sm:grid-cols-2">
        {room.players.map((player) => (
          <div
            key={player.participantId}
            className={clsx(
              "rounded-[1.25rem] border px-3 py-3 sm:rounded-[1.4rem] sm:px-4 sm:py-4",
              player.participantId === participantId ? "border-sky-300 bg-sky-50" : "border-slate-200 bg-white"
            )}
          >
            <div className="flex items-start justify-between gap-2 sm:gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                  <p className="truncate text-sm font-semibold text-slate-950 sm:text-base">{player.nickname}</p>
                  {player.isHost ? (
                    <span className="rounded-full bg-slate-950 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-white sm:px-2.5 sm:py-1 sm:text-[11px]">
                      Host
                    </span>
                  ) : null}
                  {player.participantId === participantId ? (
                    <span className="rounded-full bg-sky-500 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-white sm:px-2.5 sm:py-1 sm:text-[11px]">
                      You
                    </span>
                  ) : null}
                </div>
                <p className="mt-1 text-xs text-slate-600 sm:mt-2 sm:text-sm">{getRosterStatus(player, room.status)}</p>
              </div>
              {room.status === "round_active" && player.answeredCorrectly ? (
                <span className="shrink-0 rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-sky-700 sm:px-3 sm:py-1 sm:text-xs">
                  Solved
                </span>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function LeaderboardCard({
  room,
  participantId,
  pending,
  onContinue
}: {
  room: RoomSnapshot;
  participantId: string;
  pending: boolean;
  onContinue: () => void;
}) {
  const scoreboard = sortPlayersForBoard(room);
  const roundScores = room.round?.reveal?.roundScores ?? {};

  return (
    <div className="glass-panel rounded-[1.5rem] p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3 sm:gap-4">
        <div>
          <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500 sm:text-xs">
            {room.status === "finished"
              ? "Final scores"
              : `Round ${room.round?.roundNumber ?? room.roundsPlayed}/${room.round?.totalRounds ?? room.settings.roundCount} · Leaderboard`}
          </p>
          <h2 className="mt-1.5 text-2xl font-semibold text-slate-950 sm:mt-2 sm:text-3xl">
            {room.status === "finished" ? "Match complete" : "Round scores"}
          </h2>
        </div>
        {room.players.find((player) => player.participantId === participantId)?.isHost ? (
          <button
            type="button"
            disabled={pending}
            onClick={onContinue}
            className="rounded-full bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {room.status === "finished" ? "Back to Lobby" : "Next Round"}
          </button>
        ) : (
          <div className="rounded-full border border-sky-100 bg-sky-50 px-4 py-2.5 text-sm text-slate-600">Waiting for the host</div>
        )}
      </div>

      <div className="mt-5 space-y-2.5 sm:mt-6 sm:space-y-3">
        {scoreboard.map((player, index) => {
          const roundDelta = roundScores[player.participantId] ?? 0;

          return (
            <div
              key={player.participantId}
              className={clsx(
                "rounded-[1.25rem] border px-3 py-3 sm:rounded-[1.45rem] sm:px-4 sm:py-4",
                player.participantId === participantId ? "border-sky-300 bg-sky-50" : "border-slate-200 bg-white"
              )}
            >
              <div className="flex items-center justify-between gap-3 sm:gap-4">
                <div className="min-w-0">
                  <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500 sm:text-xs">#{index + 1}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <p className="truncate text-base font-semibold text-slate-950 sm:text-lg">{player.nickname}</p>
                    {player.isHost ? (
                      <span className="rounded-full bg-slate-950 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-white sm:px-2.5 sm:py-1 sm:text-[11px]">
                        Host
                      </span>
                    ) : null}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-2xl font-semibold text-slate-950 sm:text-3xl">{player.score}</p>
                  <p className="mt-0.5 text-xs font-semibold text-sky-700 sm:mt-1 sm:text-sm">{formatDelta(roundDelta)}</p>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function LeaveDialog({
  isHost,
  inLobby,
  pending,
  onClose,
  onLeave,
  onEndRoom
}: {
  isHost: boolean;
  inLobby: boolean;
  pending: boolean;
  onClose: () => void;
  onLeave: () => void;
  onEndRoom: () => void;
}) {
  const eyebrow = inLobby ? "Leave Room" : "Leave Game";
  const heading = inLobby ? "Leave this room?" : isHost ? "Leave or end the game?" : "Leave this game?";
  const description = inLobby
    ? isHost
      ? "Host will be passed to the next player. The room stays open"
      : "You will return home. You can rejoin if the room is still open"
    : isHost
      ? "Leaving passes host to the next player. Ending the game sends everyone home"
      : "You will leave the game and return home";
  const leaveLabel = inLobby && isHost ? "Leave and pass host" : inLobby ? "Leave room" : "Leave game";

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/30 px-4 py-6 sm:items-center">
      <div className="w-full max-w-md rounded-[1.5rem] bg-white p-4 shadow-[0_24px_64px_rgba(15,23,42,0.18)] sm:p-5">
        <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500 sm:text-xs">{eyebrow}</p>
        <h2 className="mt-1.5 text-xl font-semibold text-slate-950 sm:mt-2 sm:text-3xl">{heading}</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600 sm:mt-3">{description}</p>

        <div className="mt-5 space-y-2.5 sm:mt-6 sm:space-y-3">
          {!inLobby && isHost ? (
            <>
              <button
                type="button"
                disabled={pending}
                onClick={onLeave}
                className="w-full rounded-[1.1rem] border border-sky-200 bg-sky-50 px-4 py-3 text-left transition hover:bg-sky-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <span className="block font-semibold text-slate-950">Leave and pass host</span>
                <span className="mt-1 block text-sm text-slate-600">The game continues</span>
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={onEndRoom}
                className="w-full rounded-[1.1rem] bg-slate-950 px-4 py-3 text-left transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <span className="block font-semibold text-white">End game entirely</span>
                <span className="mt-1 block text-sm text-slate-200">Everyone is returned home</span>
              </button>
            </>
          ) : (
            <button
              type="button"
              disabled={pending}
              onClick={onLeave}
              className="w-full rounded-[1.1rem] bg-slate-950 px-4 py-3 text-left transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <span className="block font-semibold text-white">{leaveLabel}</span>
              <span className="mt-1 block text-sm text-slate-200">You can rejoin if the room is still open</span>
            </button>
          )}
        </div>

        <button
          type="button"
          disabled={pending}
          onClick={onClose}
          className="mt-4 w-full rounded-[1.1rem] border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

type PendingAck = (response: AckResponse) => void;

export function RoomClient({ roomCode }: { roomCode: string }) {
  const navigate = useNavigate();
  const socketRef = useRef<PartySocket | null>(null);
  const pendingAcks = useRef(new Map<string, PendingAck>());
  const redirectingRef = useRef(false);

  const [room, setRoom] = useState<RoomSnapshot | null>(null);
  const [participantId, setParticipantIdState] = useState("");
  const [nickname, setNicknameState] = useState(() => getNickname());
  const [needsNickname, setNeedsNickname] = useState(() => !getNickname());
  const [message, setMessage] = useState<string | null>(null);
  const [guessQuery, setGuessQuery] = useState("");
  const deferredGuessQuery = useDeferredValue(guessQuery);
  const [searchResults, setSearchResults] = useState<PlayerSearchResult[]>([]);
  const [guessFeedback, setGuessFeedback] = useState<GuessResult | null>(null);
  const [leaveDialogOpen, setLeaveDialogOpen] = useState(false);
  const [startBlockerMessage, setStartBlockerMessage] = useState<string | null>(null);
  const [now, setNow] = useState<number | null>(null);
  const [settingsExpanded, setSettingsExpanded] = useState(false);
  const [rosterExpanded, setRosterExpanded] = useState(false);
  const [pending, startTransition] = useTransition();

  const timerLabel = getTimerLabel(room, now);
  const countdownLabel = getCountdownLabel(room, now);
  const self = room?.players.find((player) => player.participantId === participantId) ?? null;
  const correctCount = room?.players.filter((player) => player.answeredCorrectly).length ?? 0;
  const visibleSearchResults = room?.status === "round_active" && deferredGuessQuery.trim() ? searchResults : [];
  const playerFilters = useMemo(
    () => (room ? getPlayerFilters(room.settings) : null),
    [room?.settings.careerEndYear, room?.settings.careerStartYear, room?.settings.careerYearMode, room?.settings.teamId]
  );
  const eligiblePlayers = useMemo(
    () => (room && playerFilters ? getEligiblePlayers(room.settings.difficulty, [], playerFilters) : []),
    [playerFilters, room?.settings.difficulty, room]
  );

  useEffect(() => {
    const handle = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(handle);
  }, []);

  const applySnapshot = useCallback((snapshot: RoomSnapshot) => {
    setRoom(snapshot);
    if (snapshot.status !== "round_active") {
      setGuessQuery("");
      setSearchResults([]);
      setGuessFeedback(null);
    }
  }, []);

  const goHome = useCallback(
    (nextMessage?: string) => {
      if (redirectingRef.current) return;
      redirectingRef.current = true;
      clearRoomMembership(roomCode);
      socketRef.current?.close();
      socketRef.current = null;
      setParticipantIdState("");
      setRoom(null);
      navigate(nextMessage ? `/?message=${encodeURIComponent(nextMessage)}` : "/");
    },
    [navigate, roomCode]
  );

  // Open the WebSocket once a nickname exists
  useEffect(() => {
    if (needsNickname) return;

    const sessionId = getOrCreateSessionId();
    const existingParticipantId = getParticipantId(roomCode) ?? "";

    const socket = new PartySocket({
      host: PARTYKIT_HOST,
      room: roomCode,
      query: {
        sessionId,
        nickname,
        participantId: existingParticipantId
      }
    });

    socketRef.current = socket;

    socket.addEventListener("message", (event: MessageEvent<string>) => {
      let msg: ServerMessage | { type: "hello"; participantId: string };
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }

      if (msg.type === "hello") {
        setParticipantIdState(msg.participantId);
        setParticipantId(roomCode, msg.participantId);
        return;
      }
      if (msg.type === "snapshot") {
        applySnapshot(msg.snapshot);
        return;
      }
      if (msg.type === "guessResult") {
        setGuessFeedback(msg.result);
        if (msg.result.status === "correct") {
          setGuessQuery("");
          setSearchResults([]);
        }
        return;
      }
      if (msg.type === "closed") {
        goHome(getRoomClosedMessage(msg.reason));
        return;
      }
      if (msg.type === "ack") {
        const pending = pendingAcks.current.get(msg.requestId);
        if (pending) {
          pendingAcks.current.delete(msg.requestId);
          pending(msg.response);
        }
        return;
      }
      if (msg.type === "error") {
        setMessage(msg.error);
      }
    });

    socket.addEventListener("close", () => {
      // Server-initiated close (e.g. room rejected join) — let user back out
      if (redirectingRef.current) return;
    });

    return () => {
      socket.close();
      socketRef.current = null;
      pendingAcks.current.clear();
    };
  }, [applySnapshot, goHome, needsNickname, nickname, roomCode]);

  useEffect(() => {
    setMessage(null);
    if (room?.status === "round_active") setRosterExpanded(false);
  }, [room?.status]);

  // Local instant search
  useEffect(() => {
    if (!deferredGuessQuery.trim() || room?.status !== "round_active" || !playerFilters) return;
    setSearchResults(searchPlayersLocal(deferredGuessQuery.trim(), 8, playerFilters));
  }, [deferredGuessQuery, playerFilters, room?.status]);

  function send(message: ClientMessage): Promise<AckResponse> {
    return new Promise((resolve) => {
      const socket = socketRef.current;
      if (!socket) {
        resolve({ ok: false, error: "Realtime connection unavailable" });
        return;
      }
      const requestId = crypto.randomUUID();
      pendingAcks.current.set(requestId, resolve);
      socket.send(JSON.stringify({ ...message, requestId }));
      // Safety timeout — never leak pending acks
      setTimeout(() => {
        if (pendingAcks.current.has(requestId)) {
          pendingAcks.current.delete(requestId);
          resolve({ ok: false, error: "Request timed out" });
        }
      }, 10_000);
    });
  }

  function submitNicknameAndJoin() {
    setMessage(null);
    const trimmed = nickname.trim();
    if (trimmed.length < 2) {
      setMessage("Nickname must be at least 2 characters");
      return;
    }
    if (trimmed.length > 20) {
      setMessage("Nickname must be at most 20 characters");
      return;
    }
    persistNickname(trimmed);
    setNicknameState(trimmed);
    setNeedsNickname(false);
  }

  function updateSettings(nextSettings: Partial<RoomSettings>) {
    if (!participantId) return;
    startTransition(async () => {
      const response = await send({ type: "updateSettings", settings: nextSettings });
      if (!response.ok) setMessage(response.error);
    });
  }

  function startGame() {
    if (!participantId) return;
    if (room && eligiblePlayers.length < room.settings.roundCount) {
      setStartBlockerMessage(
        `This setup only has ${eligiblePlayers.length} eligible players, but the match needs ${room.settings.roundCount} rounds. Widen the career years, choose more difficulties, switch Team back to All teams, or lower the round count.`
      );
      return;
    }
    if (room && room.players.length < 2) {
      setStartBlockerMessage("You need at least 2 players in the room before starting.");
      return;
    }
    startTransition(async () => {
      const response = await send({ type: "start" });
      if (!response.ok) setMessage(response.error);
    });
  }

  function submitGuess(playerId: string) {
    if (!participantId) return;
    void send({ type: "guess", playerId }).then((response) => {
      if (!response.ok) setMessage(response.error);
    });
  }

  function continueFlow() {
    if (!participantId) return;
    startTransition(async () => {
      const response = await send({ type: "continue" });
      if (!response.ok) setMessage(response.error);
    });
  }

  function endNoTimerRound() {
    if (!participantId) return;
    startTransition(async () => {
      const response = await send({ type: "endManual" });
      if (!response.ok) setMessage(response.error);
    });
  }

  function leaveGame(intent: LeaveIntent) {
    // Optimistic: fire the leave message and navigate home immediately. If the
    // socket has already disconnected, the server's onClose handler + empty-room
    // sweep clean up either way — the user shouldn't wait for an ack.
    const socket = socketRef.current;
    if (socket && socket.readyState === WebSocket.OPEN) {
      try {
        socket.send(JSON.stringify({ type: "leave", intent }));
      } catch {
        // ignore — we're leaving regardless
      }
    }
    setLeaveDialogOpen(false);
    goHome(intent === "end_room" ? "The host ended the game" : undefined);
  }

  async function shareInvite() {
    if (!room) return;
    const url = buildInviteUrl(roomCode);
    try {
      const nav = navigator as Navigator & { share?: (data: ShareData) => Promise<void> };
      if (nav.share) {
        await nav.share({ title: "NFL Path Guesser", text: "Join my NFL guessing room", url });
      } else {
        await navigator.clipboard.writeText(url);
        setMessage("Invite link copied to clipboard");
      }
    } catch {
      setMessage("Unable to share link");
    }
  }

  const inLobby = room?.status === "lobby";

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-3 px-3 py-3 sm:gap-4 sm:px-6 sm:py-6">
      <div className="glass-panel rounded-[1.5rem] px-3 py-2.5 sm:px-5 sm:py-4">
        <div className="flex flex-wrap items-center justify-between gap-2 sm:gap-3">
          <div className="flex min-w-0 flex-wrap items-center gap-2 sm:gap-3">
            <Link
              to="/"
              className="text-[10px] font-semibold uppercase tracking-[0.22em] text-sky-700 sm:text-xs sm:tracking-[0.24em]"
            >
              NFL Path Guesser
            </Link>
            <span className="hidden text-slate-300 sm:inline">·</span>
            <h1 className="text-base font-semibold text-slate-950 sm:text-2xl">Room {roomCode}</h1>
            {room ? (
              <span className="rounded-full border border-sky-100 bg-sky-50 px-2 py-0.5 text-[11px] font-medium text-slate-700 sm:px-3 sm:py-1 sm:text-xs">
                {room.players.length}/{room.settings.maxPlayers}
              </span>
            ) : null}
          </div>

          {room && !needsNickname ? (
            <div className="flex flex-wrap gap-1.5 sm:gap-2">
              <button
                type="button"
                onClick={shareInvite}
                className="rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-xs font-semibold text-slate-900 transition hover:bg-sky-100 sm:px-3 sm:py-1.5 sm:text-sm"
              >
                Invite
              </button>
              <button
                type="button"
                onClick={() => {
                  if (inLobby && !self?.isHost) {
                    leaveGame("leave");
                  } else {
                    setLeaveDialogOpen(true);
                  }
                }}
                className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-900 transition hover:bg-slate-50 sm:px-3 sm:py-1.5 sm:text-sm"
              >
                {inLobby ? "Leave Room" : "Leave Game"}
              </button>
            </div>
          ) : null}
        </div>
      </div>

      {message ? (
        <div className="rounded-[1.2rem] border border-sky-200 bg-white px-4 py-3 text-sm text-slate-900">{message}</div>
      ) : null}

      {needsNickname ? (
        <section className="glass-panel mx-auto w-full max-w-xl rounded-[1.5rem] p-4 sm:p-7">
          <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500 sm:text-xs">Join This Room</p>
          <h2 className="mt-1.5 text-2xl font-semibold text-slate-950 sm:mt-2 sm:text-3xl">Pick a nickname</h2>
          <input
            value={nickname}
            onChange={(event) => setNicknameState(event.target.value)}
            placeholder="Sunday Sniper"
            className="mt-5 w-full rounded-[1rem] border border-sky-100 bg-white px-4 py-3 text-slate-950 outline-none transition focus:border-sky-300"
          />
          <button
            type="button"
            disabled={pending}
            onClick={submitNicknameAndJoin}
            className="mt-4 w-full rounded-[1rem] bg-slate-950 px-4 py-3 font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-70"
          >
            Join Room
          </button>
        </section>
      ) : null}

      {!needsNickname && !room ? (
        <section className="glass-panel rounded-[1.5rem] p-8 text-center text-slate-600">Loading room...</section>
      ) : null}

      {!needsNickname && room ? (
        <section className="space-y-4">
          {room.status === "lobby" ? (
            <div className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
              <div className="glass-panel rounded-[1.5rem] p-4 sm:p-6">
                <div className="flex items-start justify-between gap-2 sm:gap-3">
                  <div className="min-w-0">
                    <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500 sm:text-xs">Lobby</p>
                    <h2 className="mt-1 text-xl font-semibold text-slate-950 sm:mt-1.5 sm:text-3xl">Match settings</h2>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSettingsExpanded(!settingsExpanded)}
                    className="mt-1 flex items-center gap-1.5 rounded-full border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                  >
                    {settingsExpanded ? "Collapse" : "Expand"}
                    <ChevronIcon className={clsx("h-3 w-3 transition-transform", settingsExpanded && "rotate-180")} />
                  </button>
                </div>

                {!settingsExpanded ? (
                  <p className="mt-2 text-sm text-slate-500">{formatSettingsSummary(room.settings)}</p>
                ) : null}

                {settingsExpanded ? (
                  <>
                    <div className="mt-5 grid gap-4 sm:grid-cols-2">
                      <label className="rounded-[1.25rem] border border-slate-200 bg-white p-4 text-sm text-slate-700">
                        <span className="block text-xs uppercase tracking-[0.2em] text-slate-500">Rounds</span>
                        <input
                          key={room.settings.roundCount}
                          type="number"
                          min={1}
                          max={20}
                          defaultValue={room.settings.roundCount}
                          disabled={!self?.isHost}
                          onBlur={(event) => {
                            const parsed = Number(event.target.value);
                            const clamped = Math.min(20, Math.max(1, isNaN(parsed) || parsed < 1 ? 1 : parsed));
                            if (clamped !== room.settings.roundCount) {
                              updateSettings({ roundCount: clamped });
                            }
                          }}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") event.currentTarget.blur();
                          }}
                          className="mt-3 w-full rounded-[0.9rem] border border-slate-200 bg-slate-50 px-3 py-2 outline-none focus:border-sky-300 disabled:opacity-60"
                        />
                      </label>

                      <label className="rounded-[1.25rem] border border-slate-200 bg-white p-4 text-sm text-slate-700">
                        <span className="block text-xs uppercase tracking-[0.2em] text-slate-500">Timer</span>
                        <select
                          value={room.settings.timePerRoundSeconds === null ? "none" : String(room.settings.timePerRoundSeconds)}
                          disabled={!self?.isHost}
                          onChange={(event) =>
                            updateSettings({
                              timePerRoundSeconds: event.target.value === "none" ? null : Number(event.target.value)
                            })
                          }
                          className="mt-3 w-full rounded-[0.9rem] border border-slate-200 bg-slate-50 px-3 py-2 outline-none focus:border-sky-300 disabled:opacity-60"
                        >
                          <option value="none">No timer</option>
                          <option value="15">15 seconds</option>
                          <option value="30">30 seconds</option>
                          <option value="45">45 seconds</option>
                          <option value="60">60 seconds</option>
                        </select>
                      </label>

                      <label className="rounded-[1.25rem] border border-slate-200 bg-white p-4 text-sm text-slate-700">
                        <span className="block text-xs uppercase tracking-[0.2em] text-slate-500">Scoring</span>
                        <select
                          value={room.settings.mode}
                          disabled={!self?.isHost}
                          onChange={(event) => updateSettings({ mode: event.target.value as RoomSettings["mode"] })}
                          className="mt-3 w-full rounded-[0.9rem] border border-slate-200 bg-slate-50 px-3 py-2 outline-none focus:border-sky-300 disabled:opacity-60"
                        >
                          <option value="kahoot">Time Based</option>
                          <option value="sudden_death">Sudden Death</option>
                        </select>
                      </label>

                      <div className="rounded-[1.25rem] border border-slate-200 bg-white p-4 text-sm text-slate-700">
                        <span className="block text-xs uppercase tracking-[0.2em] text-slate-500">Years under teams</span>
                        <button
                          type="button"
                          disabled={!self?.isHost}
                          onClick={() => updateSettings({ showYears: !room.settings.showYears })}
                          className={clsx(
                            "mt-3 inline-flex w-full items-center justify-between rounded-[0.9rem] border px-3 py-2 text-left transition disabled:opacity-60",
                            room.settings.showYears
                              ? "border-sky-200 bg-sky-50 text-sky-700"
                              : "border-slate-200 bg-slate-50 text-slate-700"
                          )}
                        >
                          <span>{room.settings.showYears ? "Showing years" : "Years hidden"}</span>
                          <span>{room.settings.showYears ? "On" : "Off"}</span>
                        </button>
                      </div>

                      <div className="rounded-[1.25rem] border border-slate-200 bg-white p-4 text-sm text-slate-700">
                        <span className="block text-xs uppercase tracking-[0.2em] text-slate-500">Position hint</span>
                        <button
                          type="button"
                          disabled={!self?.isHost}
                          onClick={() => updateSettings({ showPosition: !room.settings.showPosition })}
                          className={clsx(
                            "mt-3 inline-flex w-full items-center justify-between rounded-[0.9rem] border px-3 py-2 text-left transition disabled:opacity-60",
                            room.settings.showPosition
                              ? "border-sky-200 bg-sky-50 text-sky-700"
                              : "border-slate-200 bg-slate-50 text-slate-700"
                          )}
                        >
                          <span>{room.settings.showPosition ? "Showing position" : "Position hidden"}</span>
                          <span>{room.settings.showPosition ? "On" : "Off"}</span>
                        </button>
                      </div>

                      <label className="rounded-[1.25rem] border border-slate-200 bg-white p-4 text-sm text-slate-700">
                        <span className="block text-xs uppercase tracking-[0.2em] text-slate-500">Team</span>
                        <select
                          value={room.settings.teamId}
                          disabled={!self?.isHost}
                          onChange={(event) => updateSettings({ teamId: event.target.value as TeamId | "all" })}
                          className="mt-3 w-full rounded-[0.9rem] border border-slate-200 bg-slate-50 px-3 py-2 outline-none focus:border-sky-300 disabled:opacity-60"
                        >
                          <option value="all">All teams</option>
                          {(Object.keys(NFL_TEAMS) as TeamId[]).map((teamId) => (
                            <option key={teamId} value={teamId}>
                              {formatTeamLabel(teamId)}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>

                    <div className="mt-4">
                      <YearRangeSlider
                        mode={room.settings.careerYearMode}
                        startYear={room.settings.careerStartYear}
                        endYear={room.settings.careerEndYear}
                        disabled={!self?.isHost}
                        onModeChange={(careerYearMode) => updateSettings({ careerYearMode })}
                        onReset={() =>
                          updateSettings({
                            careerYearMode: DEFAULT_ROOM_SETTINGS.careerYearMode,
                            careerStartYear: DEFAULT_ROOM_SETTINGS.careerStartYear,
                            careerEndYear: DEFAULT_ROOM_SETTINGS.careerEndYear
                          })
                        }
                        onChange={updateSettings}
                      />
                    </div>

                    <div className="mt-4 rounded-[1.25rem] border border-slate-200 bg-white p-4">
                      <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Difficulty</p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {DIFFICULTY_OPTIONS.map((difficulty) => {
                          const active = room.settings.difficulty.includes(difficulty);
                          return (
                            <button
                              key={difficulty}
                              type="button"
                              disabled={!self?.isHost}
                              onClick={() => {
                                const nextDifficulty = active
                                  ? room.settings.difficulty.filter((value) => value !== difficulty)
                                  : [...room.settings.difficulty, difficulty];
                                updateSettings({ difficulty: nextDifficulty });
                              }}
                              className={clsx(
                                "rounded-full border px-3 py-2 text-sm font-semibold capitalize transition disabled:opacity-60",
                                active ? "border-sky-300 bg-sky-100 text-sky-900" : "border-slate-200 bg-slate-50 text-slate-700"
                              )}
                            >
                              {difficulty}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div className="mt-4 grid grid-cols-3 gap-2">
                      <div className="rounded-[1.1rem] border border-slate-200 bg-white p-3">
                        <p className="text-[10px] uppercase tracking-[0.18em] text-slate-400">Pool</p>
                        <p className="mt-1 text-xl font-semibold text-slate-950">{eligiblePlayers.length}</p>
                      </div>
                      <div className="rounded-[1.1rem] border border-slate-200 bg-white p-3">
                        <p className="text-[10px] uppercase tracking-[0.18em] text-slate-400">Rounds</p>
                        <p className="mt-1 text-xl font-semibold text-slate-950">{room.settings.roundCount}</p>
                      </div>
                      <div className="rounded-[1.1rem] border border-slate-200 bg-white p-3">
                        <p className="text-[10px] uppercase tracking-[0.18em] text-slate-400">Team</p>
                        <p className="mt-1 text-xl font-semibold text-slate-950">{room.settings.teamId === "all" ? "All" : room.settings.teamId}</p>
                      </div>
                    </div>
                  </>
                ) : null}

                <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-sm text-slate-600">
                    {room.canStart ? "Ready to start" : "Need 2+ players and enough eligible players"}
                  </p>
                  {self?.isHost ? (
                    <button
                      type="button"
                      disabled={pending}
                      onClick={startGame}
                      className="rounded-full bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Start Game
                    </button>
                  ) : (
                    <div className="rounded-full border border-sky-100 bg-sky-50 px-4 py-2 text-sm text-slate-600">
                      Waiting for the host to start
                    </div>
                  )}
                </div>
              </div>

              <PlayerRosterCard room={room} participantId={participantId} title="Players" subtitle="Room" />
            </div>
          ) : null}

          {room.status === "countdown" ? (
            <>
              <div className="glass-panel rounded-[1.5rem] px-4 py-6 text-center sm:px-8 sm:py-10">
                <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500 sm:text-xs">
                  Round {room.round?.roundNumber}/{room.round?.totalRounds}
                </p>
                <div className="mt-4 text-6xl font-semibold leading-none text-slate-950 sm:mt-5 sm:text-7xl lg:text-8xl">
                  {countdownLabel}
                </div>
                <p className="mt-3 text-sm text-slate-600 sm:mt-4 sm:text-base">Get ready</p>
              </div>
              <PlayerRosterCard room={room} participantId={participantId} title="Players" subtitle="Countdown" />
            </>
          ) : null}

          {room.status === "round_active" ? (
            <>
              <div className="glass-panel rounded-[1.5rem] px-3 py-2.5 sm:px-5 sm:py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                    <span className="text-[10px] uppercase tracking-[0.22em] text-slate-500 sm:text-xs sm:tracking-[0.24em]">
                      Round {room.round?.roundNumber}/{room.round?.totalRounds}
                    </span>
                    <span className="text-sm font-semibold text-slate-700">
                      {timerLabel === null ? "No timer" : `${timerLabel}s`}
                    </span>
                    <span className="text-[11px] text-slate-500 sm:text-xs">
                      {correctCount}/{room.players.length} solved
                    </span>
                    {room.round?.position ? (
                      <span className="rounded-full border border-sky-100 bg-sky-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-sky-800 sm:text-xs">
                        {room.round.position}
                      </span>
                    ) : null}
                  </div>
                  {room.settings.timePerRoundSeconds === null && self?.isHost ? (
                    <button
                      type="button"
                      onClick={endNoTimerRound}
                      className="rounded-full border border-sky-200 bg-sky-50 px-3 py-1.5 text-sm font-semibold text-sky-800"
                    >
                      Reveal
                    </button>
                  ) : null}
                </div>
              </div>

              <div className="glass-panel rounded-[1.5rem] p-3 sm:p-5">
                <div className="grid grid-cols-2 gap-2 sm:gap-3 md:grid-cols-3 xl:grid-cols-4">
                  {room.round?.teamStints.map((stint, index) => {
                    const team = NFL_TEAMS[stint.teamId];
                    return (
                      <article
                        key={`${stint.teamId}-${index}-${stint.startYear}`}
                        className="rounded-[1rem] border border-slate-200 bg-white p-2.5 sm:rounded-[1.1rem] sm:p-3"
                      >
                        <div className="flex items-start gap-2">
                          <img
                            src={team.logoUrl}
                            alt=""
                            width={40}
                            height={40}
                            className="h-9 w-9 shrink-0 object-contain sm:h-10 sm:w-10"
                          />
                          <div className="min-w-0">
                            <p className="text-[10px] uppercase tracking-[0.2em] text-slate-400">Stop {index + 1}</p>
                            <h3 className="mt-1 text-sm font-semibold leading-tight text-slate-950 sm:mt-1.5 sm:text-base">
                              {formatTeamLabel(stint.teamId)}
                            </h3>
                          </div>
                        </div>
                        <p className="mt-0.5 text-[11px] text-slate-500 sm:text-xs">{stint.teamId}</p>
                        {room.settings.showYears ? (
                          <p className="mt-1.5 text-[11px] font-medium text-slate-700 sm:mt-2 sm:text-xs">
                            {formatYearRange(stint.startYear, stint.endYear)}
                          </p>
                        ) : null}
                        <div className="mt-2 h-1 rounded-full sm:mt-3 sm:h-1.5" style={{ backgroundColor: team.primary }} />
                      </article>
                    );
                  })}
                </div>
              </div>

              <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
                <div className="glass-panel rounded-[1.5rem] p-3 sm:p-5">
                  <input
                    value={guessQuery}
                    onChange={(event) => {
                      const nextValue = event.target.value;
                      setGuessQuery(nextValue);
                      if (!nextValue.trim()) setSearchResults([]);
                    }}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter") return;
                      const normalized = guessQuery.trim().toLowerCase();
                      if (!normalized) return;
                      const exactMatch = searchResults.find(
                        (result) => result.fullName.toLowerCase() === normalized
                      );
                      if (exactMatch) {
                        event.preventDefault();
                        submitGuess(exactMatch.id);
                      }
                    }}
                    disabled={self?.answeredCorrectly}
                    placeholder={self?.answeredCorrectly ? "You already solved it" : "Search player names"}
                    autoComplete="off"
                    autoCorrect="off"
                    autoCapitalize="none"
                    spellCheck={false}
                    inputMode="search"
                    className="w-full rounded-[1rem] border border-slate-200 bg-white px-4 py-3 text-slate-950 outline-none transition focus:border-sky-300 disabled:bg-slate-100 disabled:text-slate-500"
                  />

                  {guessFeedback ? (
                    <div
                      className={clsx(
                        "mt-3 rounded-[1.15rem] border px-4 py-3 text-sm",
                        guessFeedback.status === "wrong"
                          ? "border-rose-200 bg-rose-50 text-rose-800"
                          : guessFeedback.status === "correct"
                            ? "border-sky-200 bg-sky-50 text-sky-800"
                            : "border-slate-200 bg-slate-50 text-slate-700"
                      )}
                    >
                      {guessFeedback.message}
                      {typeof guessFeedback.currentCap === "number" ? ` Max remaining: ${guessFeedback.currentCap}` : ""}
                      {typeof guessFeedback.score === "number" ? ` Score: ${guessFeedback.score}` : ""}
                    </div>
                  ) : null}

                  {visibleSearchResults.length > 0 ? (
                    <div className="mt-3 grid gap-2">
                      {visibleSearchResults.map((result) => (
                        <button
                          key={result.id}
                          type="button"
                          onClick={() => submitGuess(result.id)}
                          className="flex items-center gap-3 rounded-[1rem] border border-slate-200 bg-white px-3 py-2.5 text-left text-sm font-medium text-slate-800 transition hover:bg-slate-50"
                        >
                          <img
                            src={result.headshotUrl}
                            alt=""
                            width={40}
                            height={40}
                            className="h-10 w-10 shrink-0 rounded-full border border-slate-200 bg-slate-50 object-cover"
                          />
                          <span className="min-w-0">
                            <span className="block truncate">{result.fullName}</span>
                            <span className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">{result.position}</span>
                          </span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>

                <div className="flex flex-col gap-3">
                  <button
                    type="button"
                    onClick={() => setRosterExpanded(!rosterExpanded)}
                    className="glass-panel flex w-full items-center justify-between rounded-[1.5rem] px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 lg:hidden"
                  >
                    <span>
                      Players ({room.players.length}/{room.settings.maxPlayers}) · {correctCount} solved
                    </span>
                    <ChevronIcon className={clsx("h-4 w-4 transition-transform", rosterExpanded && "rotate-180")} />
                  </button>

                  <div className={clsx(rosterExpanded ? "block" : "hidden", "lg:block")}>
                    <PlayerRosterCard room={room} participantId={participantId} title="Players" subtitle="Live status" />
                  </div>
                </div>
              </div>
            </>
          ) : null}

          {room.status === "round_reveal" && room.round?.reveal ? (
            <div className="glass-panel rounded-[1.5rem] p-4 sm:p-6">
              <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500 sm:text-xs">
                Round {room.round?.roundNumber}/{room.round?.totalRounds} · Reveal
              </p>
              <div className="mt-4 grid gap-4 sm:mt-5 sm:gap-6 lg:grid-cols-[240px_1fr] lg:items-start">
                <div className="mx-auto w-40 overflow-hidden rounded-[1.4rem] border border-slate-200 bg-slate-50 sm:w-56 lg:mx-0 lg:w-auto">
                  <img
                    src={room.round.reveal.player.headshotUrl}
                    alt={room.round.reveal.player.fullName}
                    width={320}
                    height={320}
                    className="h-auto w-full object-cover"
                  />
                </div>

                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-sky-700 sm:text-sm">Answer</p>
                  <h2 className="mt-1.5 break-words text-2xl font-semibold text-slate-950 sm:mt-2 sm:text-3xl lg:text-4xl">
                    {room.round.reveal.player.fullName}
                  </h2>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {room.settings.showPosition ? (
                      <span className="rounded-full border border-sky-100 bg-sky-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-sky-800 sm:text-sm">
                        {room.round.reveal.player.position}
                      </span>
                    ) : null}
                    <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold capitalize tracking-[0.08em] text-slate-700 sm:text-sm">
                      {room.round.reveal.player.difficulty}
                    </span>
                  </div>
                  <div className="mt-4 grid gap-2.5 sm:mt-5 sm:gap-3 sm:grid-cols-2">
                    {room.round.reveal.player.teamStints.map((stint, index) => {
                      const team = NFL_TEAMS[stint.teamId];
                      return (
                        <div
                          key={`${stint.teamId}-${index}-${stint.startYear}`}
                          className="rounded-[1.1rem] border border-slate-200 bg-white p-3 sm:p-4"
                        >
                          <div className="flex items-center gap-2.5">
                            <img
                              src={team.logoUrl}
                              alt=""
                              width={44}
                              height={44}
                              className="h-10 w-10 shrink-0 object-contain sm:h-11 sm:w-11"
                            />
                            <p className="text-sm font-semibold text-slate-950 sm:text-base">{formatTeamLabel(stint.teamId)}</p>
                          </div>
                          <p className="mt-0.5 text-xs text-slate-600 sm:mt-1 sm:text-sm">
                            {formatYearRange(stint.startYear, stint.endYear)}
                          </p>
                          <div className="mt-2.5 h-1.5 rounded-full sm:mt-3 sm:h-2" style={{ backgroundColor: team.primary }} />
                        </div>
                      );
                    })}
                  </div>

                  <div className="mt-5 sm:mt-6">
                    {self?.isHost ? (
                      <button
                        type="button"
                        disabled={pending}
                        onClick={continueFlow}
                        className="w-full rounded-full bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
                      >
                        Continue to Leaderboard
                      </button>
                    ) : (
                      <div className="rounded-full border border-sky-100 bg-sky-50 px-4 py-2 text-center text-sm text-slate-600 sm:text-left">
                        Waiting for the host
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          {(room.status === "round_leaderboard" || room.status === "finished") && room.round?.reveal ? (
            <LeaderboardCard room={room} participantId={participantId} pending={pending} onContinue={continueFlow} />
          ) : null}
        </section>
      ) : null}

      {leaveDialogOpen && self ? (
        <LeaveDialog
          isHost={self.isHost}
          inLobby={Boolean(inLobby)}
          pending={pending}
          onClose={() => setLeaveDialogOpen(false)}
          onLeave={() => leaveGame("leave")}
          onEndRoom={() => leaveGame("end_room")}
        />
      ) : null}

      {startBlockerMessage ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 px-4">
          <div className="w-full max-w-md rounded-[1.5rem] bg-white p-5 shadow-2xl">
            <p className="text-xs uppercase tracking-[0.22em] text-rose-500">Can’t start yet</p>
            <h2 className="mt-2 text-xl font-semibold text-slate-950">Player pool is too small</h2>
            <p className="mt-3 text-sm leading-6 text-slate-600">{startBlockerMessage}</p>
            <button
              type="button"
              onClick={() => setStartBlockerMessage(null)}
              className="mt-5 w-full rounded-full bg-slate-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800"
            >
              Adjust Settings
            </button>
          </div>
        </div>
      ) : null}
    </main>
  );
}
