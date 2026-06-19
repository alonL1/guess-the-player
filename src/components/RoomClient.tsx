import clsx from "clsx";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Link, useNavigate } from "react-router-dom";
import PartySocket from "partysocket";

import { CATALOG_YEAR_RANGE, findPlayerById, getEligiblePlayers, searchPlayers as searchPlayersLocal } from "@/lib/catalog";
import type { AckResponse, ClientMessage, GuessResult, ServerMessage } from "@/lib/messages";
import { NFL_TEAMS, formatTeamLabel } from "@/lib/nfl-teams";
import { formatPositionGroup, POSITION_GROUP_OPTIONS } from "@/lib/positions";
import { DEFAULT_ROOM_SETTINGS } from "@/lib/settings";
import { TeamPath } from "@/components/TeamPath";
import { PlayerDetailCard } from "@/components/PlayerDetailCard";
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
  PositionGroup,
  RoomSettings,
  RoomSnapshot,
  TeamId
} from "@/lib/types";
import { normalizeSearchText } from "@/lib/utils";

const PARTYKIT_HOST = import.meta.env.VITE_PARTYKIT_HOST || "127.0.0.1:1999";
const DIFFICULTY_OPTIONS: Difficulty[] = ["easy", "medium", "hard", "impossible"];

function clampRoundCount(value: number) {
  return Math.min(20, Math.max(1, value));
}

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
  const positionGroup = formatPositionGroup(settings.positionGroup);
  const yearMode =
    settings.careerYearMode === "entered"
      ? "Entered"
      : settings.careerYearMode === "retired"
        ? "Retired"
        : settings.careerYearMode === "current"
          ? "Current players"
          : "Full career must fit";
  const years = settings.careerYearMode === "current" ? "" : ` ${settings.careerStartYear}-${settings.careerEndYear}`;
  const showYears = settings.showYears ? "Years on" : "Years off";
  const showPosition = settings.showPosition ? "Position on" : "Position off";
  return `${settings.roundCount} rounds · ${timer} · ${scoring} · ${difficulties} · ${yearMode}${years} · ${team} · ${positionGroup} · ${showYears} · ${showPosition}`;
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

function SettingCard({
  label,
  children
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0 py-2">
      <p className="font-pixel text-helmet text-[0.5rem] sm:text-[0.625rem]">{label}</p>
      <div className="mt-3">{children}</div>
    </div>
  );
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
  const safeStartYear = Math.min(Math.max(startYear, minYear), maxYear);
  const shouldDisplayLegacyDefaultAsCurrent =
    mode === "full_career" &&
    safeStartYear === DEFAULT_ROOM_SETTINGS.careerStartYear &&
    endYear >= maxYear - 1;
  const rawSafeEndYear = shouldDisplayLegacyDefaultAsCurrent ? maxYear : endYear;
  const safeEndYear = Math.min(Math.max(rawSafeEndYear, safeStartYear), maxYear);
  const range = Math.max(maxYear - minYear, 1);
  const startPercent = ((safeStartYear - minYear) / range) * 100;
  const endPercent = ((safeEndYear - minYear) / range) * 100;
  const yearLabel = `${safeStartYear}-${safeEndYear === maxYear ? "Current" : safeEndYear}`;
  const description =
    mode === "current"
      ? "Only signed players and recent free agents are eligible."
      : mode === "entered"
        ? "Only players who entered the league inside this range are eligible."
        : mode === "retired"
          ? "Only players whose final catalog season is inside this range are eligible."
          : "Only players whose full career fits inside this range are eligible.";

  return (
    <div className="py-2">
      <div className="flex items-center justify-between gap-3">
        <p className="font-pixel text-helmet text-[0.5rem] sm:text-[0.625rem]">Career years</p>
        <button
          type="button"
          disabled={disabled}
          onClick={onReset}
          className="pixel-button pixel-button-ghost min-h-0 px-2 py-1 text-[0.5rem]"
        >
          Reset
        </button>
      </div>
      <select
        value={mode}
        disabled={disabled}
        onChange={(event) => onModeChange(event.target.value as CareerYearMode)}
        className="pixel-select mt-3"
      >
        <option value="entered">Year Entering League</option>
        <option value="retired">Year Retired</option>
        <option value="full_career">Full career must fit</option>
        <option value="current">Current Players Only</option>
      </select>
      {mode !== "current" ? (
        <>
          <p className="font-pixel text-chalk mt-3 text-[0.5rem] sm:text-[0.625rem]">{yearLabel}</p>
          <div className="year-range-field mt-3">
            <div className="absolute left-0 right-0 top-1/2 h-2 -translate-y-1/2 border-2 border-yardline bg-endzone" />
            <div
              className="absolute top-1/2 h-2 -translate-y-1/2 bg-helmet"
              style={{ left: `${startPercent}%`, right: `${100 - endPercent}%` }}
            />
            <input
              type="range"
              min={minYear}
              max={maxYear}
              value={safeStartYear}
              disabled={disabled}
              onChange={(event) => {
                const nextStart = Math.min(Number(event.target.value), safeEndYear);
                onChange({ careerStartYear: nextStart, careerEndYear: safeEndYear });
              }}
              className="year-range-input"
              aria-label="Career start year"
            />
            <input
              type="range"
              min={minYear}
              max={maxYear}
              value={safeEndYear}
              disabled={disabled}
              onChange={(event) => {
                const nextEnd = Math.max(Number(event.target.value), safeStartYear);
                onChange({ careerStartYear: safeStartYear, careerEndYear: nextEnd });
              }}
              className="year-range-input"
              aria-label="Career end year"
            />
          </div>
        </>
      ) : null}
      <p className="font-readable text-chalk-dim mt-3 text-base leading-tight">{description}</p>
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

type ConnStatus = "connecting" | "open" | "reconnecting";

function InlineSpinner() {
  return <span className="blink ml-2 inline-block">▮</span>;
}

function ConnIndicator({ status }: { status: ConnStatus }) {
  if (status === "open") {
    return <span className="pixel-tag pixel-tag-green">● Live</span>;
  }
  return <span className="pixel-tag pixel-tag-yellow blink">● Sync…</span>;
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
    <div className="pixel-panel p-3 sm:p-4">
      <div className="flex items-start justify-between gap-2 sm:gap-3">
        <div className="min-w-0">
          <p className="font-pixel text-helmet text-[0.5rem] sm:text-[0.625rem]">{subtitle}</p>
          <h2 className="font-pixel text-chalk mt-2 text-sm sm:text-base">{title}</h2>
        </div>
        <span className="pixel-tag pixel-tag-yellow shrink-0">
          {room.players.length}/{room.settings.maxPlayers}
        </span>
      </div>

      <div className="mt-4 grid gap-2 sm:gap-3 sm:grid-cols-2">
        {room.players.map((player) => (
          <div
            key={player.participantId}
            className={clsx(
              "border-4 p-3",
              player.participantId === participantId
                ? "border-helmet bg-endzone"
                : "border-yardline bg-endzone"
            )}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <p className="font-readable text-chalk truncate text-base sm:text-lg">{player.nickname}</p>
                  {player.isHost ? <span className="pixel-tag pixel-tag-yellow">Host</span> : null}
                  {player.participantId === participantId ? (
                    <span className="pixel-tag pixel-tag-blue">You</span>
                  ) : null}
                </div>
                <p className="font-pixel text-chalk-dim mt-2 text-[0.5rem] sm:text-[0.55rem]">
                  {getRosterStatus(player, room.status)}
                </p>
              </div>
              {room.status === "round_active" && player.answeredCorrectly ? (
                <span className="pixel-tag pixel-tag-green shrink-0">Solved</span>
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
    <div className="pixel-panel-accent p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3 sm:gap-4">
        <div>
          <p className="font-pixel text-helmet text-[0.55rem] sm:text-xs">
            {room.status === "finished"
              ? "▼ Final scores"
              : `▼ Round ${room.round?.roundNumber ?? room.roundsPlayed}/${room.round?.totalRounds ?? room.settings.roundCount}`}
          </p>
          <h2 className="font-pixel text-chalk mt-2 text-base sm:text-2xl">
            {room.status === "finished" ? "Match Complete" : "Scoreboard"}
          </h2>
        </div>
        {room.players.find((player) => player.participantId === participantId)?.isHost ? (
          <button
            type="button"
            disabled={pending}
            onClick={onContinue}
            className="pixel-button pixel-button-primary"
          >
            {pending ? (
              <>
                Loading
                <InlineSpinner />
              </>
            ) : room.status === "finished" ? (
              "↩ Back to Lobby"
            ) : (
              "Next Round ▶"
            )}
          </button>
        ) : (
          <span className="pixel-tag pixel-tag-yellow">Waiting for the host</span>
        )}
      </div>

      <div className="mt-5 space-y-2 sm:mt-6 sm:space-y-2.5">
        {scoreboard.map((player, index) => {
          const roundDelta = roundScores[player.participantId] ?? 0;
          const isSelf = player.participantId === participantId;
          const isPodium = index < 3;

          return (
            <div
              key={player.participantId}
              className={clsx(
                "flex items-center justify-between gap-3 border-4 px-3 py-3 sm:px-4",
                isSelf ? "border-helmet bg-endzone" : "border-yardline bg-endzone"
              )}
            >
              <div className="flex min-w-0 items-center gap-3">
                <span
                  className={clsx(
                    "font-pixel shrink-0 text-base sm:text-lg",
                    isPodium ? "text-helmet" : "text-chalk-dim"
                  )}
                >
                  {String(index + 1).padStart(2, "0")}
                </span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-readable text-chalk truncate text-base sm:text-lg">{player.nickname}</p>
                    {player.isHost ? <span className="pixel-tag pixel-tag-yellow">Host</span> : null}
                  </div>
                </div>
              </div>
              <div className="shrink-0 text-right">
                <p className="font-pixel text-helmet text-base sm:text-2xl">{player.score}</p>
                <p className="font-pixel text-good mt-1 text-[0.55rem] sm:text-xs">{formatDelta(roundDelta)}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function FinishedSummary({ room, participantId }: { room: RoomSnapshot; participantId: string }) {
  const history = room.roundHistory ?? [];
  const [expandedRound, setExpandedRound] = useState<number | null>(null);
  if (history.length === 0) return null;

  // Sickest pull: the lowest-familiarity player that anyone guessed correctly,
  // attributed to the first participant who got it.
  const pulls = history.filter((entry) => entry.correctOrder.length > 0);
  const sickest = pulls.length
    ? pulls.reduce((lowest, entry) => (entry.player.familiarity < lowest.player.familiarity ? entry : lowest))
    : null;
  const sickestNickname = sickest
    ? room.players.find((p) => p.participantId === sickest.correctOrder[0])?.nickname ?? "A player"
    : null;

  return (
    <div className="grid gap-4">
      {sickest ? (
        <div className="pixel-panel-flat border-helmet p-4 sm:p-5">
          <p className="font-pixel text-helmet text-[0.55rem] sm:text-xs">🔥 Sickest Pull</p>
          <p className="font-readable text-chalk mt-1 text-sm sm:text-base">
            <span className="text-good">{sickestNickname}</span> got the sickest pull with {sickest.player.fullName}.
          </p>
          <div className="mt-4">
            <PlayerDetailCard player={sickest.player} />
          </div>
        </div>
      ) : null}

      <div className="pixel-panel p-4 sm:p-6">
        <p className="font-pixel text-helmet text-[0.55rem] sm:text-xs">▼ Game Summary</p>
        <div className="mt-4 grid gap-2">
          {history.map((entry, index) => {
            const roundNumber = index + 1;
            const expanded = expandedRound === roundNumber;
            const gotIt = entry.correctOrder.includes(participantId);
            const myScore = entry.roundScores[participantId] ?? 0;
            return (
              <div key={roundNumber} className="border-4 border-yardline bg-endzone">
                <button
                  type="button"
                  onClick={() => setExpandedRound(expanded ? null : roundNumber)}
                  className="flex w-full flex-wrap items-center justify-between gap-2 p-3 text-left hover:border-helmet"
                >
                  <div className="min-w-0">
                    <p className="font-pixel text-helmet text-[0.5rem] sm:text-[0.55rem]">
                      RND {roundNumber} {expanded ? "▲" : "▼"}
                    </p>
                    <p className="font-readable text-chalk mt-1 truncate text-base sm:text-lg">
                      {entry.player.fullName}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="font-pixel text-helmet text-sm sm:text-lg">+{myScore}</p>
                    <p
                      className={clsx(
                        "font-pixel mt-1 text-[0.45rem] sm:text-[0.55rem]",
                        gotIt ? "text-good" : "text-jersey-red"
                      )}
                    >
                      {gotIt ? "got it" : "missed"}
                    </p>
                  </div>
                </button>
                {expanded ? (
                  <div className="border-t-4 border-yardline p-3 sm:p-4">
                    <PlayerDetailCard player={entry.player} />
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
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
      ? "Host will pass to the next player. The room stays open."
      : "You will return home. You can rejoin if the room is still open."
    : isHost
      ? "Leaving passes host to the next player. Ending sends everyone home."
      : "You will leave the game and return home.";
  const leaveLabel = inLobby && isHost ? "Leave & pass host" : inLobby ? "Leave room" : "Leave game";

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-endzone/80 px-4 py-6 sm:items-center">
      <div className="pixel-panel-accent w-full max-w-md p-4 sm:p-5">
        <p className="font-pixel text-helmet text-[0.55rem] sm:text-xs">▼ {eyebrow}</p>
        <h2 className="font-pixel text-chalk mt-2 text-sm sm:text-lg">{heading}</h2>
        <p className="font-readable text-chalk-dim mt-3 text-base leading-snug">{description}</p>

        <div className="mt-5 space-y-3">
          {!inLobby && isHost ? (
            <>
              <button
                type="button"
                disabled={pending}
                onClick={onLeave}
                className="pixel-button pixel-button-secondary w-full"
              >
                Leave & Pass Host
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={onEndRoom}
                className="pixel-button pixel-button-primary w-full"
              >
                End Game
              </button>
            </>
          ) : (
            <button
              type="button"
              disabled={pending}
              onClick={onLeave}
              className="pixel-button pixel-button-primary w-full"
            >
              {leaveLabel}
            </button>
          )}
        </div>

        <button
          type="button"
          disabled={pending}
          onClick={onClose}
          className="pixel-button pixel-button-ghost mt-4 w-full"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

type PendingAck = (response: AckResponse) => void;
type StartBlocker = {
  heading: string;
  message: string;
};

export function RoomClient({ roomCode }: { roomCode: string }) {
  const navigate = useNavigate();
  const socketRef = useRef<PartySocket | null>(null);
  const pendingAcks = useRef(new Map<string, PendingAck>());
  const redirectingRef = useRef(false);
  const hasConnectedRef = useRef(false);
  const wasOpenRef = useRef(false);
  const lastResyncRef = useRef(0);
  const lastSnapshotAtRef = useRef(0);

  const [connStatus, setConnStatus] = useState<ConnStatus>("connecting");
  const [room, setRoom] = useState<RoomSnapshot | null>(null);
  const [participantId, setParticipantIdState] = useState("");
  const [nickname, setNicknameState] = useState(() => getNickname());
  const [needsNickname, setNeedsNickname] = useState(() => !getNickname());
  const [message, setMessage] = useState<string | null>(null);
  const [guessQuery, setGuessQuery] = useState("");
  const deferredGuessQuery = useDeferredValue(guessQuery);
  const [searchResults, setSearchResults] = useState<PlayerSearchResult[]>([]);
  const [guessFeedback, setGuessFeedback] = useState<GuessResult | null>(null);
  // Players this client guessed incorrectly this round, in guess order, tracked
  // locally (the server doesn't record which wrong players were guessed). Used to
  // red-theme those search results and to show the last wrong guess on reveal.
  const [myWrongGuessIds, setMyWrongGuessIds] = useState<string[]>([]);
  const [leaveDialogOpen, setLeaveDialogOpen] = useState(false);
  const [startBlocker, setStartBlocker] = useState<StartBlocker | null>(null);
  const [now, setNow] = useState<number | null>(null);
  const [settingsExpanded, setSettingsExpanded] = useState(false);
  const [rosterExpanded, setRosterExpanded] = useState(false);
  const [roundInput, setRoundInput] = useState("");
  const [pending, startTransition] = useTransition();

  const timerLabel = getTimerLabel(room, now);
  const countdownLabel = getCountdownLabel(room, now);
  const self = room?.players.find((player) => player.participantId === participantId) ?? null;
  const correctCount = room?.players.filter((player) => player.answeredCorrectly).length ?? 0;
  const visibleSearchResults = room?.status === "round_active" && deferredGuessQuery.trim() ? searchResults : [];

  useEffect(() => {
    if (room) setRoundInput(String(room.settings.roundCount));
  }, [room?.settings.roundCount]);

  const playerFilters = useMemo(
    () => (room ? getPlayerFilters(room.settings) : null),
    [
      room?.settings.careerEndYear,
      room?.settings.careerStartYear,
      room?.settings.careerYearMode,
      room?.settings.positionGroup,
      room?.settings.teamId
    ]
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
    lastSnapshotAtRef.current = Date.now();
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

  // Ask the server to re-send the current snapshot. Used on reconnect and when
  // the staleness watchdog detects we're stuck behind a transition. Throttled
  // so the 250ms tick can't spam it; sent raw (no ack/requestId needed).
  const requestResync = useCallback(() => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    const nowMs = Date.now();
    if (nowMs - lastResyncRef.current < 2000) return;
    lastResyncRef.current = nowMs;
    try {
      socket.send(JSON.stringify({ type: "sync" }));
    } catch {
      // socket not ready — watchdog will retry on the next tick
    }
  }, []);

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
      },
      // Recover fast from blips (mobile screen-lock, backgrounded tabs) without
      // the default backoff that can wait up to ~10s. Min is kept off the floor
      // so a saturated link isn't hammered with sub-second handshake retries.
      minReconnectionDelay: 600,
      maxReconnectionDelay: 4000,
      reconnectionDelayGrowFactor: 1.4
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

    return () => {
      socket.close();
      socketRef.current = null;
      pendingAcks.current.clear();
    };
  }, [applySnapshot, goHome, needsNickname, nickname, roomCode]);

  // Self-healing connection status. Derived from the socket's live readyState
  // rather than from open/close/error events, which can desync (e.g. a spurious
  // error leaving the banner stuck on "reconnecting" even after we're back).
  // Polling means status always reflects reality within a tick, and we trigger a
  // resync on the transition back to OPEN.
  useEffect(() => {
    if (needsNickname) return;
    const handle = window.setInterval(() => {
      if (redirectingRef.current) return;
      const socket = socketRef.current;
      if (!socket) return;
      if (socket.readyState === WebSocket.OPEN) {
        setConnStatus("open");
        if (!wasOpenRef.current && hasConnectedRef.current) requestResync();
        wasOpenRef.current = true;
        hasConnectedRef.current = true;
      } else {
        setConnStatus(hasConnectedRef.current ? "reconnecting" : "connecting");
        wasOpenRef.current = false;
      }
    }, 300);
    return () => window.clearInterval(handle);
  }, [needsNickname, requestResync]);

  useEffect(() => {
    setMessage(null);
    if (room?.status === "round_active") setRosterExpanded(false);
    // Clear last round's wrong guesses as a new round spins up.
    if (room?.status === "countdown") setMyWrongGuessIds([]);
  }, [room?.status]);

  useEffect(() => {
    if (!deferredGuessQuery.trim() || room?.status !== "round_active" || !playerFilters) return;
    setSearchResults(searchPlayersLocal(deferredGuessQuery.trim(), 8, playerFilters));
  }, [deferredGuessQuery, playerFilters, room?.status]);

  // Staleness watchdog: if a transition snapshot never arrived AND no snapshot
  // has landed for a few seconds (a genuine stall, not just a slow link still
  // delivering), ask for a fresh one. Gating on "no recent snapshot" avoids
  // piling resync traffic onto an already-congested connection between rounds.
  useEffect(() => {
    if (!room || now === null) return;
    const stalled = now - lastSnapshotAtRef.current > 3000;
    if (!stalled) return;
    if (room.status === "countdown" && room.round?.countdownEndsAt) {
      if (now > new Date(room.round.countdownEndsAt).getTime() + 1500) requestResync();
    }
    if (room.status === "round_active" && room.round?.endsAt) {
      if (now > new Date(room.round.endsAt).getTime() + 2000) requestResync();
    }
  }, [now, room, requestResync]);

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
    if (room && room.players.length < 2) {
      setStartBlocker({
        heading: "Need more participants",
        message: "You need at least 2 participants in the room before starting."
      });
      return;
    }
    if (room && eligiblePlayers.length < room.settings.roundCount) {
      setStartBlocker({
        heading: "Player pool is too small",
        message: `This setup only has ${eligiblePlayers.length} eligible NFL players, but the match needs ${room.settings.roundCount} rounds. Widen the career years, choose more difficulties, switch Team or Position Group back to All, or lower the round count.`
      });
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
      if (!response.ok) {
        setMessage(response.error);
        return;
      }
      // Remember incorrect guesses so we can red-theme those search results and
      // show the last wrong pick on the reveal screen.
      if (response.result?.status === "wrong") {
        setMyWrongGuessIds((prev) => (prev.includes(playerId) ? prev : [...prev, playerId]));
      }
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

  // Host-only: abort the current match and send the room back to the lobby
  // (everyone stays). The snapshot broadcast moves all clients to the lobby.
  function endMatch() {
    if (!participantId) return;
    startTransition(async () => {
      const response = await send({ type: "endGame" });
      if (!response.ok) setMessage(response.error);
    });
  }

  function leaveGame(intent: LeaveIntent) {
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
  const isFinalCountdown = countdownLabel === 1;
  // We've overrun a server deadline AND nothing has arrived recently (a genuine
  // stall, matching the watchdog's resync condition). Used to show a "Catching
  // up…" hint so a stuck client knows what's happening — without flashing it on
  // every merely-slow transition.
  const isStalled = now !== null && now - lastSnapshotAtRef.current > 3000;
  const isCatchingUp =
    isStalled &&
    now !== null &&
    ((room?.status === "countdown" &&
      !!room.round?.countdownEndsAt &&
      now > new Date(room.round.countdownEndsAt).getTime() + 1500) ||
      (room?.status === "round_active" &&
        !!room.round?.endsAt &&
        now > new Date(room.round.endsAt).getTime() + 2000));

  // Reveal-screen outcome for this client.
  const revealGotIt = self?.answeredCorrectly ?? false;
  const revealPoints = self?.roundScore ?? 0;
  const lastWrongGuessId = myWrongGuessIds.length > 0 ? myWrongGuessIds[myWrongGuessIds.length - 1] : null;
  const wrongGuessPlayer =
    room?.status === "round_reveal" && !revealGotIt && lastWrongGuessId
      ? findPlayerById(lastWrongGuessId)
      : null;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-3 px-3 py-3 sm:gap-4 sm:px-6 sm:py-6">
      <div className="scoreboard px-3 py-3 sm:px-5 sm:py-4">
        <div className="flex flex-wrap items-center justify-between gap-2 sm:gap-3">
          <div className="flex min-w-0 flex-wrap items-center gap-2 sm:gap-3">
            <Link
              to="/"
              className="font-pixel text-helmet text-[0.5rem] sm:text-[0.625rem]"
            >
              ◀ NFL Path Guesser
            </Link>
            <span className="hidden text-helmet/40 sm:inline">|</span>
            <h1 className="font-pixel text-helmet text-xs sm:text-lg">ROOM {roomCode}</h1>
            {room ? (
              <span className="pixel-tag pixel-tag-yellow">
                {room.players.length}/{room.settings.maxPlayers}
              </span>
            ) : null}
            {!needsNickname ? <ConnIndicator status={connStatus} /> : null}
          </div>

          {room && !needsNickname ? (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={shareInvite}
                className="pixel-button pixel-button-secondary min-h-0 px-3 py-2 text-[0.5rem] sm:text-[0.625rem]"
              >
                Invite
              </button>
              {self?.isHost && !inLobby ? (
                <button
                  type="button"
                  disabled={pending}
                  onClick={endMatch}
                  className="pixel-button pixel-button-accent min-h-0 px-3 py-2 text-[0.5rem] sm:text-[0.625rem]"
                >
                  End Game
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => {
                  // No dialog needed if you're alone (nobody to pass host to) or
                  // a non-host in the lobby (no host-transfer concerns).
                  const alone = (room?.players.length ?? 0) <= 1;
                  if (alone || (inLobby && !self?.isHost)) {
                    leaveGame("leave");
                  } else {
                    setLeaveDialogOpen(true);
                  }
                }}
                className="pixel-button pixel-button-ghost min-h-0 px-3 py-2 text-[0.5rem] sm:text-[0.625rem]"
              >
                {inLobby ? "Leave Room" : "Leave Game"}
              </button>
            </div>
          ) : null}
        </div>
      </div>

      {!needsNickname && connStatus === "reconnecting" ? (
        <div className="pixel-panel-flat border-helmet p-3">
          <p className="font-pixel text-helmet text-[0.55rem] sm:text-xs">
            <span className="blink">⟳</span> Reconnecting…
          </p>
        </div>
      ) : null}

      {message ? (
        <div className="pixel-panel-flat border-jersey-red p-3">
          <p className="font-readable text-chalk text-base">{message}</p>
        </div>
      ) : null}

      {needsNickname ? (
        <section className="pixel-panel-accent mx-auto w-full max-w-xl p-4 sm:p-5">
          <p className="font-pixel text-helmet text-[0.55rem] sm:text-xs">▼ Join This Room</p>
          <h2 className="font-pixel text-chalk mt-2 text-base sm:text-lg">Pick a nickname</h2>
          <input
            value={nickname}
            onChange={(event) => setNicknameState(event.target.value)}
            placeholder="SUNDAY SNIPER"
            className="pixel-input mt-5"
          />
          <button
            type="button"
            disabled={pending}
            onClick={submitNicknameAndJoin}
            className="pixel-button pixel-button-primary mt-4 w-full"
          >
            ▶ Join Room
          </button>
        </section>
      ) : null}

      {!needsNickname && !room ? (
        <section className="pixel-panel p-8 text-center">
          <p className="font-pixel text-helmet text-xs sm:text-sm blink">
            {connStatus === "open" ? "Loading room…" : "Connecting to the field…"}
          </p>
        </section>
      ) : null}

      {!needsNickname && room ? (
        <section className="space-y-4">
          {room.status === "lobby" ? (
            <div className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
              <div className="pixel-panel p-4 sm:p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-pixel text-helmet text-[0.55rem] sm:text-xs">▼ Lobby</p>
                    <h2 className="font-pixel text-chalk mt-2 text-base sm:text-lg">Match Settings</h2>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSettingsExpanded(!settingsExpanded)}
                    className="pixel-button pixel-button-ghost min-h-0 gap-2 px-3 py-2 text-[0.55rem]"
                  >
                    {settingsExpanded ? "Collapse" : "Expand"}
                    <ChevronIcon className={clsx("h-3 w-3 transition-transform", settingsExpanded && "rotate-180")} />
                  </button>
                </div>

                {!settingsExpanded ? (
                  <p className="font-readable text-chalk-dim mt-3 text-base leading-tight break-words">
                    {formatSettingsSummary(room.settings)}
                  </p>
                ) : null}

                {settingsExpanded ? (
                  <>
                    <div className="mt-5 grid gap-3 sm:gap-4 sm:grid-cols-2">
                      <SettingCard label="Rounds">
                        <input
                          type="number"
                          min={1}
                          max={20}
                          value={roundInput}
                          disabled={!self?.isHost}
                          onChange={(event) => {
                            const nextValue = event.target.value;
                            setRoundInput(nextValue);
                            if (nextValue.trim() === "") return;
                            const parsed = Number(nextValue);
                            if (!Number.isFinite(parsed)) return;
                            const clamped = clampRoundCount(parsed);
                            if (clamped !== room.settings.roundCount) {
                              updateSettings({ roundCount: clamped });
                            }
                          }}
                          onBlur={(event) => {
                            if (event.target.value.trim() === "") {
                              setRoundInput(String(room.settings.roundCount));
                              return;
                            }
                            const parsed = Number(event.target.value);
                            const clamped = clampRoundCount(Number.isFinite(parsed) ? parsed : room.settings.roundCount);
                            setRoundInput(String(clamped));
                            if (clamped !== room.settings.roundCount) {
                              updateSettings({ roundCount: clamped });
                            }
                          }}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") event.currentTarget.blur();
                          }}
                          className="pixel-input"
                        />
                      </SettingCard>

                      <SettingCard label="Timer">
                        <select
                          value={room.settings.timePerRoundSeconds === null ? "none" : String(room.settings.timePerRoundSeconds)}
                          disabled={!self?.isHost}
                          onChange={(event) =>
                            updateSettings({
                              timePerRoundSeconds: event.target.value === "none" ? null : Number(event.target.value)
                            })
                          }
                          className="pixel-select"
                        >
                          <option value="none">No timer</option>
                          <option value="15">15 seconds</option>
                          <option value="30">30 seconds</option>
                          <option value="45">45 seconds</option>
                          <option value="60">60 seconds</option>
                        </select>
                      </SettingCard>

                      <SettingCard label="Scoring">
                        <select
                          value={room.settings.mode}
                          disabled={!self?.isHost}
                          onChange={(event) => updateSettings({ mode: event.target.value as RoomSettings["mode"] })}
                          className="pixel-select"
                        >
                          <option value="kahoot">Time Based</option>
                          <option value="sudden_death">Sudden Death</option>
                        </select>
                      </SettingCard>

                      <SettingCard label="Years Under Teams">
                        <button
                          type="button"
                          disabled={!self?.isHost}
                          onClick={() => updateSettings({ showYears: !room.settings.showYears })}
                          className={clsx(
                            "pixel-button w-full",
                            room.settings.showYears ? "pixel-button-accent" : "pixel-button-ghost"
                          )}
                        >
                          {room.settings.showYears ? "ON" : "OFF"}
                        </button>
                      </SettingCard>

                      <SettingCard label="Position Hint">
                        <button
                          type="button"
                          disabled={!self?.isHost}
                          onClick={() => updateSettings({ showPosition: !room.settings.showPosition })}
                          className={clsx(
                            "pixel-button w-full",
                            room.settings.showPosition ? "pixel-button-accent" : "pixel-button-ghost"
                          )}
                        >
                          {room.settings.showPosition ? "ON" : "OFF"}
                        </button>
                      </SettingCard>

                      <SettingCard label="Team">
                        <select
                          value={room.settings.teamId}
                          disabled={!self?.isHost}
                          onChange={(event) => updateSettings({ teamId: event.target.value as TeamId | "all" })}
                          className="pixel-select"
                        >
                          <option value="all">All teams</option>
                          {(Object.keys(NFL_TEAMS) as TeamId[]).map((teamId) => (
                            <option key={teamId} value={teamId}>
                              {formatTeamLabel(teamId)}
                            </option>
                          ))}
                        </select>
                      </SettingCard>

                      <SettingCard label="Position Group">
                        <select
                          value={room.settings.positionGroup}
                          disabled={!self?.isHost}
                          onChange={(event) => updateSettings({ positionGroup: event.target.value as PositionGroup })}
                          className="pixel-select"
                        >
                          {POSITION_GROUP_OPTIONS.map((positionGroup) => (
                            <option key={positionGroup} value={positionGroup}>
                              {formatPositionGroup(positionGroup)}
                            </option>
                          ))}
                        </select>
                      </SettingCard>
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

                    <div className="mt-4 py-2">
                      <p className="font-pixel text-helmet text-[0.5rem] sm:text-[0.625rem]">Difficulty</p>
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
                                "pixel-button min-h-0 px-3 py-2 text-[0.55rem] capitalize",
                                active ? "pixel-button-accent" : "pixel-button-ghost"
                              )}
                            >
                              {difficulty}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
                      <div className="pixel-panel-flat p-3 text-center">
                        <p className="font-pixel text-helmet text-[0.45rem] sm:text-[0.55rem]">Pool</p>
                        <p className="font-pixel text-chalk mt-2 text-sm sm:text-lg">{eligiblePlayers.length}</p>
                      </div>
                      <div className="pixel-panel-flat p-3 text-center">
                        <p className="font-pixel text-helmet text-[0.45rem] sm:text-[0.55rem]">Rounds</p>
                        <p className="font-pixel text-chalk mt-2 text-sm sm:text-lg">{room.settings.roundCount}</p>
                      </div>
                      <div className="pixel-panel-flat p-3 text-center">
                        <p className="font-pixel text-helmet text-[0.45rem] sm:text-[0.55rem]">Team</p>
                        <p className="font-pixel text-chalk mt-2 text-sm sm:text-lg">
                          {room.settings.teamId === "all" ? "All" : room.settings.teamId}
                        </p>
                      </div>
                      <div className="pixel-panel-flat p-3 text-center">
                        <p className="font-pixel text-helmet text-[0.45rem] sm:text-[0.55rem]">Positions</p>
                        <p className="font-pixel text-chalk mt-2 text-sm sm:text-lg">
                          {room.settings.positionGroup === "special_teams"
                            ? "ST"
                            : room.settings.positionGroup === "all"
                              ? "All"
                              : formatPositionGroup(room.settings.positionGroup)}
                        </p>
                      </div>
                    </div>
                  </>
                ) : null}

                <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <p className="font-readable text-chalk text-base">
                    {room.canStart ? "Ready to start" : "Need 2+ participants and enough eligible NFL players"}
                  </p>
                  {self?.isHost ? (
                    <button
                      type="button"
                      disabled={pending}
                      onClick={startGame}
                      className="pixel-button pixel-button-primary w-full sm:w-auto"
                    >
                      {pending ? (
                        <>
                          Starting
                          <InlineSpinner />
                        </>
                      ) : (
                        "▶ START GAME"
                      )}
                    </button>
                  ) : (
                    <span className="pixel-tag pixel-tag-yellow">Waiting for host</span>
                  )}
                </div>
              </div>

              <PlayerRosterCard room={room} participantId={participantId} title="Participants" subtitle="Room" />
            </div>
          ) : null}

          {room.status === "countdown" ? (
            <>
              <div className="scoreboard scanline px-4 py-8 text-center sm:px-8 sm:py-12">
                <p className="font-pixel text-helmet text-[0.625rem] sm:text-sm">
                  ROUND {room.round?.roundNumber}/{room.round?.totalRounds}
                </p>
                <div
                  className={clsx("font-pixel text-helmet mt-6 leading-none", isFinalCountdown && "blink")}
                  style={{ fontSize: "var(--fs-display)" }}
                >
                  {countdownLabel}
                </div>
                <p className="font-pixel text-chalk mt-6 text-[0.55rem] sm:text-xs">
                  {isCatchingUp ? <span className="text-helmet blink">CATCHING UP…</span> : "GET READY"}
                </p>
              </div>
              <PlayerRosterCard room={room} participantId={participantId} title="Participants" subtitle="Countdown" />
            </>
          ) : null}

          {room.status === "round_active" ? (
            <>
              <div className="scoreboard px-3 py-3 sm:px-5 sm:py-3">
                <div className="flex flex-wrap items-center justify-between gap-2 sm:gap-3">
                  <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                    <span className="font-pixel text-helmet text-[0.55rem] sm:text-xs">
                      RND {room.round?.roundNumber}/{room.round?.totalRounds}
                    </span>
                    <span
                      className={clsx(
                        "font-pixel text-[0.625rem] sm:text-sm",
                        typeof timerLabel === "number" && timerLabel <= 5 ? "text-jersey-red blink" : "text-chalk"
                      )}
                    >
                      {timerLabel === null ? "NO TIMER" : `${timerLabel}s`}
                    </span>
                    <span className="font-pixel text-chalk-dim text-[0.5rem] sm:text-[0.625rem]">
                      {correctCount}/{room.players.length} solved
                    </span>
                    {isCatchingUp ? <span className="pixel-tag pixel-tag-yellow blink">Catching up…</span> : null}
                  </div>
                  {room.settings.timePerRoundSeconds === null && self?.isHost ? (
                    <button
                      type="button"
                      onClick={endNoTimerRound}
                      className="pixel-button pixel-button-accent min-h-0 px-3 py-2 text-[0.55rem]"
                    >
                      Reveal
                    </button>
                  ) : null}
                </div>
              </div>

              <div className="pixel-panel p-3 sm:p-4">
                {room.round?.position ? (
                  <div className="mb-3 flex items-center justify-center gap-2 border-4 border-helmet bg-endzone px-3 py-2">
                    <span className="font-pixel text-chalk-dim text-[0.5rem] sm:text-[0.625rem]">POSITION</span>
                    <span className="font-pixel text-helmet text-sm sm:text-lg">{room.round.position}</span>
                  </div>
                ) : null}
                <TeamPath teamStints={room.round?.teamStints ?? []} showYears={room.settings.showYears} />
              </div>

              <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
                <div className="pixel-panel p-3 sm:p-4">
                  <input
                    value={guessQuery}
                    onChange={(event) => {
                      const nextValue = event.target.value;
                      setGuessQuery(nextValue);
                      if (!nextValue.trim()) setSearchResults([]);
                    }}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter") return;
                      const normalized = normalizeSearchText(guessQuery);
                      if (!normalized) return;
                      const exactMatch = searchResults.find(
                        (result) => normalizeSearchText(result.fullName) === normalized
                      );
                      if (exactMatch) {
                        event.preventDefault();
                        submitGuess(exactMatch.id);
                      }
                    }}
                    disabled={self?.answeredCorrectly}
                    placeholder={self?.answeredCorrectly ? "YOU SOLVED IT" : "TYPE PLAYER NAME"}
                    autoComplete="off"
                    autoCorrect="off"
                    autoCapitalize="none"
                    spellCheck={false}
                    inputMode="search"
                    className="pixel-input"
                  />

                  {guessFeedback ? (
                    <div
                      className={clsx(
                        "mt-3 border-4 p-3",
                        guessFeedback.status === "wrong"
                          ? "border-jersey-red bg-endzone"
                          : guessFeedback.status === "correct"
                            ? "border-good bg-endzone"
                            : "border-yardline bg-endzone"
                      )}
                    >
                      <p
                        className={clsx(
                          "font-pixel text-[0.55rem] sm:text-xs",
                          guessFeedback.status === "wrong"
                            ? "text-jersey-red"
                            : guessFeedback.status === "correct"
                              ? "text-good"
                              : "text-chalk"
                        )}
                      >
                        {guessFeedback.message}
                        {typeof guessFeedback.currentCap === "number" ? ` · Max ${guessFeedback.currentCap}` : ""}
                        {typeof guessFeedback.score === "number" ? ` · +${guessFeedback.score}` : ""}
                      </p>
                    </div>
                  ) : null}

                  {visibleSearchResults.length > 0 ? (
                    <div className="mt-3 grid gap-2">
                      {visibleSearchResults.map((result) => {
                        const wasWrong = myWrongGuessIds.includes(result.id);
                        return (
                          <button
                            key={result.id}
                            type="button"
                            onClick={() => submitGuess(result.id)}
                            className={clsx(
                              "flex items-center gap-3 border-4 p-2 text-left",
                              wasWrong
                                ? "border-jersey-red bg-[#3a1416]"
                                : "border-yardline bg-endzone hover:border-helmet"
                            )}
                          >
                            <img
                              src={result.headshotUrl}
                              alt=""
                              width={40}
                              height={40}
                              className={clsx(
                                "h-10 w-10 shrink-0 border-2 object-cover",
                                wasWrong ? "border-jersey-red bg-[#3a1416] opacity-70" : "border-yardline bg-endzone"
                              )}
                            />
                            <span className="min-w-0">
                              <span
                                className={clsx(
                                  "block truncate font-readable text-base sm:text-lg",
                                  wasWrong ? "text-jersey-red line-through" : "text-chalk"
                                )}
                              >
                                {result.fullName}
                              </span>
                              <span
                                className={clsx(
                                  "font-pixel text-[0.5rem] sm:text-[0.55rem]",
                                  wasWrong ? "text-jersey-red" : "text-helmet"
                                )}
                              >
                                {result.position}
                              </span>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  ) : null}
                </div>

                <div className="flex flex-col gap-3">
                  <button
                    type="button"
                    onClick={() => setRosterExpanded(!rosterExpanded)}
                    className="pixel-panel-flat flex w-full items-center justify-between gap-2 px-4 py-3 lg:hidden"
                  >
                    <span className="font-pixel text-helmet text-[0.55rem] sm:text-xs">
                      PARTICIPANTS {room.players.length}/{room.settings.maxPlayers} · {correctCount} SOLVED
                    </span>
                    <ChevronIcon className={clsx("h-4 w-4 text-chalk transition-transform", rosterExpanded && "rotate-180")} />
                  </button>

                  <div className={clsx(rosterExpanded ? "block" : "hidden", "lg:block")}>
                    <PlayerRosterCard room={room} participantId={participantId} title="Participants" subtitle="Live status" />
                  </div>
                </div>
              </div>
            </>
          ) : null}

          {room.status === "round_reveal" && room.round?.reveal ? (
            <div className="pixel-panel-accent p-4 sm:p-6">
              <p className="font-pixel text-helmet text-[0.55rem] sm:text-xs">
                ▼ Round {room.round?.roundNumber}/{room.round?.totalRounds} · Reveal
              </p>

              {/* Outcome banner — did this client get it, and points if so */}
              <div
                className={clsx(
                  "mt-3 flex flex-wrap items-center justify-between gap-2 border-4 px-3 py-2.5 sm:mt-4 sm:px-4 sm:py-3",
                  revealGotIt ? "border-good bg-endzone" : "border-jersey-red bg-endzone"
                )}
              >
                <p className={clsx("font-pixel text-xs sm:text-base", revealGotIt ? "text-good" : "text-jersey-red")}>
                  {revealGotIt ? "✓ YOU GOT IT" : "✗ YOU MISSED IT"}
                </p>
                {revealGotIt ? (
                  <span className="pixel-tag pixel-tag-green text-[0.6rem] sm:text-xs">+{revealPoints} PTS</span>
                ) : null}
              </div>

              <div className="mt-4 grid gap-4 sm:mt-5 sm:gap-6 lg:grid-cols-[240px_1fr] lg:items-start">
                <div className="mx-auto w-40 overflow-hidden border-4 border-helmet bg-endzone sm:w-56 lg:mx-0 lg:w-auto">
                  <img
                    src={room.round.reveal.player.headshotUrl}
                    alt={room.round.reveal.player.fullName}
                    width={320}
                    height={320}
                    className="h-auto w-full object-cover"
                  />
                </div>

                <div>
                  <p className="font-pixel text-good text-[0.55rem] sm:text-xs">▼ ANSWER</p>
                  <h2 className="font-pixel text-chalk mt-2 break-words text-base sm:text-xl lg:text-2xl">
                    {room.round.reveal.player.fullName}
                  </h2>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <span className="pixel-tag pixel-tag-yellow">{room.round.reveal.player.position}</span>
                    <span className="pixel-tag pixel-tag-blue capitalize">{room.round.reveal.player.difficulty}</span>
                  </div>
                  <div className="mt-4 sm:mt-5">
                    <TeamPath teamStints={room.round.reveal.player.teamStints} showYears />
                  </div>
                </div>
              </div>

              {/* Your wrong guess (only if you missed and actually guessed someone) */}
              {wrongGuessPlayer ? (
                <div className="mt-4 border-4 border-jersey-red bg-endzone p-3 sm:mt-5 sm:p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-pixel text-jersey-red text-[0.5rem] sm:text-[0.625rem]">✗ YOU GUESSED</p>
                    <p className="font-readable text-chalk text-sm sm:text-base">{wrongGuessPlayer.fullName}</p>
                    <span className="pixel-tag pixel-tag-blue capitalize text-[0.5rem]">{wrongGuessPlayer.position}</span>
                  </div>
                  <div className="mt-3">
                    <TeamPath teamStints={wrongGuessPlayer.teamStints} showYears compact tone="danger" />
                  </div>
                </div>
              ) : null}

              <div className="mt-5 sm:mt-6">
                {self?.isHost ? (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={continueFlow}
                    className="pixel-button pixel-button-primary w-full sm:w-auto"
                  >
                    {pending ? (
                      <>
                        Loading
                        <InlineSpinner />
                      </>
                    ) : (
                      "Continue ▶"
                    )}
                  </button>
                ) : (
                  <span className="pixel-tag pixel-tag-yellow">Waiting for the host</span>
                )}
              </div>
            </div>
          ) : null}

          {(room.status === "round_leaderboard" || room.status === "finished") && room.round?.reveal ? (
            <LeaderboardCard room={room} participantId={participantId} pending={pending} onContinue={continueFlow} />
          ) : null}

          {room.status === "finished" ? <FinishedSummary room={room} participantId={participantId} /> : null}
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

      {startBlocker ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-endzone/80 px-4">
          <div className="pixel-panel-accent w-full max-w-md p-4 sm:p-5">
            <p className="font-pixel text-jersey-red text-[0.55rem] sm:text-xs">▼ Can't start yet</p>
            <h2 className="font-pixel text-chalk mt-2 text-sm sm:text-lg">{startBlocker.heading}</h2>
            <p className="font-readable text-chalk-dim mt-3 text-base leading-snug">{startBlocker.message}</p>
            <button
              type="button"
              onClick={() => setStartBlocker(null)}
              className="pixel-button pixel-button-primary mt-5 w-full"
            >
              Adjust Settings ▶
            </button>
          </div>
        </div>
      ) : null}
    </main>
  );
}
