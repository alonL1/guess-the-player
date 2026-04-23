"use client";

import clsx from "clsx";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useDeferredValue, useEffect, useRef, useState, useTransition } from "react";
import { io, type Socket } from "socket.io-client";

import { NFL_TEAMS, formatTeamLabel } from "@/lib/nfl-teams";
import type { Difficulty, LeaveIntent, RoomClosedReason, RoomPlayer, RoomSettings, RoomSnapshot } from "@/lib/types";
import { formatYearRange } from "@/lib/utils";

type JoinResponse = {
  roomCode: string;
  participantId: string;
  participantToken: string;
  snapshot: RoomSnapshot;
};

type SearchResultsResponse = {
  results: Array<{ id: string; fullName: string }>;
};

type GuessFeedback = {
  status: "wrong" | "correct" | "duplicate";
  message: string;
  currentCap?: number;
  score?: number;
};

type SnapshotAck = {
  ok: boolean;
  error?: string;
  snapshot?: RoomSnapshot;
};

type LeaveAck = {
  ok: boolean;
  error?: string;
  closed?: boolean;
  reason?: RoomClosedReason | null;
  snapshot?: RoomSnapshot | null;
};

const DIFFICULTY_OPTIONS: Difficulty[] = ["easy", "medium", "hard", "impossible"];

function roomTokenKey(roomCode: string) {
  return `guess-the-player-production-09c4.up:token:${roomCode}`;
}

function roomParticipantKey(roomCode: string) {
  return `guess-the-player-production-09c4.up:participant:${roomCode}`;
}

function clearRoomAuth(roomCode: string) {
  localStorage.removeItem(roomTokenKey(roomCode));
  localStorage.removeItem(roomParticipantKey(roomCode));
}

async function requestGuestSession(nickname: string) {
  const response = await fetch("/api/session/guest", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ nickname })
  });

  const body = (await response.json().catch(() => null)) as { error?: string } | null;
  if (!response.ok) {
    throw new Error(body?.error ?? "Unable to create session.");
  }
}

async function joinRoom(roomCode: string) {
  const response = await fetch(`/api/rooms/${roomCode}/join`, {
    method: "POST"
  });

  const body = (await response.json().catch(() => null)) as JoinResponse & { error?: string };
  if (!response.ok) {
    throw new Error(body.error ?? "Unable to join room.");
  }

  return body;
}

async function reconnectRoom(roomCode: string, participantToken: string) {
  const response = await fetch(`/api/rooms/${roomCode}/reconnect`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ participantToken })
  });

  const body = (await response.json().catch(() => null)) as JoinResponse & { error?: string };
  if (!response.ok) {
    throw new Error(body.error ?? "Unable to reconnect.");
  }

  return body;
}

async function searchPlayers(query: string) {
  const response = await fetch(`/api/players/search?q=${encodeURIComponent(query)}`);
  if (!response.ok) {
    return [];
  }

  const body = (await response.json().catch(() => null)) as SearchResultsResponse | null;
  return body?.results ?? [];
}

function getTimerLabel(room: RoomSnapshot | null, now: number | null) {
  if (now === null || !room?.round?.endsAt) {
    return null;
  }

  const remainingMs = new Date(room.round.endsAt).getTime() - now;
  return Math.max(0, Math.ceil(remainingMs / 1000));
}

function getCountdownLabel(room: RoomSnapshot | null, now: number | null) {
  if (now === null || !room?.round?.countdownEndsAt) {
    return null;
  }

  const remainingMs = new Date(room.round.countdownEndsAt).getTime() - now;
  return Math.max(1, Math.ceil(remainingMs / 1000));
}

function sortPlayersForBoard(room: RoomSnapshot | null) {
  if (!room) {
    return [];
  }

  return [...room.players].sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }

    return left.nickname.localeCompare(right.nickname);
  });
}

function formatDelta(points: number) {
  return `${points >= 0 ? "+" : ""}${points}`;
}

function getRoomClosedMessage(reason: RoomClosedReason) {
  if (reason === "host_ended") {
    return "The host ended the game.";
  }

  return "The room closed.";
}

function getRosterStatus(player: RoomPlayer, roomStatus: RoomSnapshot["status"]) {
  if (!player.connected) {
    return "Disconnected";
  }

  if (roomStatus === "round_active") {
    return player.answeredCorrectly ? "Solved" : "Guessing";
  }

  if (roomStatus === "countdown") {
    return "Ready";
  }

  if (roomStatus === "round_reveal") {
    return player.answeredCorrectly ? "Locked in" : "Waiting";
  }

  return "In room";
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
    <div className="glass-panel rounded-[1.5rem] p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.24em] text-slate-500">{subtitle}</p>
          <h2 className="mt-2 text-2xl font-semibold text-slate-950">{title}</h2>
        </div>
        <div className="rounded-full border border-sky-100 bg-sky-50 px-3 py-1 text-sm font-medium text-slate-700">
          {room.players.length}/{room.settings.maxPlayers}
        </div>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        {room.players.map((player) => (
          <div
            key={player.participantId}
            className={clsx(
              "rounded-[1.4rem] border px-4 py-4",
              player.participantId === participantId ? "border-sky-300 bg-sky-50" : "border-slate-200 bg-white"
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-base font-semibold text-slate-950">{player.nickname}</p>
                  {player.isHost ? (
                    <span className="rounded-full bg-slate-950 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-white">
                      Host
                    </span>
                  ) : null}
                  {player.participantId === participantId ? (
                    <span className="rounded-full bg-sky-500 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-white">
                      You
                    </span>
                  ) : null}
                </div>
                <p className="mt-2 text-sm text-slate-600">{getRosterStatus(player, room.status)}</p>
              </div>
              {room.status === "round_active" && player.answeredCorrectly ? (
                <span className="rounded-full bg-sky-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-sky-700">
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
    <div className="glass-panel rounded-[1.5rem] p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.24em] text-slate-500">
            {room.status === "finished" ? "Final scores" : "Leaderboard"}
          </p>
          <h2 className="mt-2 text-3xl font-semibold text-slate-950">
            {room.status === "finished" ? "Match complete." : "Round scores."}
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
          <div className="rounded-full border border-sky-100 bg-sky-50 px-4 py-2.5 text-sm text-slate-600">Waiting for the host.</div>
        )}
      </div>

      <div className="mt-6 space-y-3">
        {scoreboard.map((player, index) => {
          const roundDelta = roundScores[player.participantId] ?? 0;

          return (
            <div
              key={player.participantId}
              className={clsx(
                "rounded-[1.45rem] border px-4 py-4",
                player.participantId === participantId ? "border-sky-300 bg-sky-50" : "border-slate-200 bg-white"
              )}
            >
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-xs uppercase tracking-[0.22em] text-slate-500">#{index + 1}</p>
                  <div className="mt-1 flex items-center gap-2">
                    <p className="text-lg font-semibold text-slate-950">{player.nickname}</p>
                    {player.isHost ? (
                      <span className="rounded-full bg-slate-950 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-white">
                        Host
                      </span>
                    ) : null}
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-3xl font-semibold text-slate-950">{player.score}</p>
                  <p className="mt-1 text-sm font-semibold text-sky-700">{formatDelta(roundDelta)}</p>
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
  pending,
  onClose,
  onLeave,
  onEndRoom
}: {
  isHost: boolean;
  pending: boolean;
  onClose: () => void;
  onLeave: () => void;
  onEndRoom: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/30 px-4 py-6 sm:items-center">
      <div className="w-full max-w-md rounded-[1.5rem] bg-white p-5 shadow-[0_24px_64px_rgba(15,23,42,0.18)]">
        <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Leave Game</p>
        <h2 className="mt-2 text-3xl font-semibold text-slate-950">
          {isHost ? "Leave or end the room?" : "Leave this room?"}
        </h2>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          {isHost
            ? "Leaving passes host to the next player. Ending the room sends everyone home."
            : "You will leave the room and return home."}
        </p>

        <div className="mt-6 space-y-3">
          {isHost ? (
            <>
              <button
                type="button"
                disabled={pending}
                onClick={onLeave}
                className="w-full rounded-[1.1rem] border border-sky-200 bg-sky-50 px-4 py-3 text-left transition hover:bg-sky-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <span className="block font-semibold text-slate-950">Leave and pass host</span>
                <span className="mt-1 block text-sm text-slate-600">The room stays open.</span>
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={onEndRoom}
                className="w-full rounded-[1.1rem] bg-slate-950 px-4 py-3 text-left transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <span className="block font-semibold text-white">End game entirely</span>
                <span className="mt-1 block text-sm text-slate-200">Everyone is returned home.</span>
              </button>
            </>
          ) : (
            <button
              type="button"
              disabled={pending}
              onClick={onLeave}
              className="w-full rounded-[1.1rem] bg-slate-950 px-4 py-3 text-left transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <span className="block font-semibold text-white">Leave room</span>
              <span className="mt-1 block text-sm text-slate-200">You can join again later if the room is still open.</span>
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

export function RoomClient({ roomCode }: { roomCode: string }) {
  const router = useRouter();
  const socketRef = useRef<Socket | null>(null);
  const redirectingRef = useRef(false);
  const [room, setRoom] = useState<RoomSnapshot | null>(null);
  const [participantId, setParticipantId] = useState("");
  const [participantToken, setParticipantToken] = useState("");
  const [nickname, setNickname] = useState(() =>
    typeof window === "undefined" ? "" : localStorage.getItem("guess-the-player:nickname") ?? ""
  );
  const [needsNickname, setNeedsNickname] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [guessQuery, setGuessQuery] = useState("");
  const deferredGuessQuery = useDeferredValue(guessQuery);
  const [searchResults, setSearchResults] = useState<Array<{ id: string; fullName: string }>>([]);
  const [guessFeedback, setGuessFeedback] = useState<GuessFeedback | null>(null);
  const [leaveDialogOpen, setLeaveDialogOpen] = useState(false);
  const [now, setNow] = useState<number | null>(null);
  const [pending, startTransition] = useTransition();

  const timerLabel = getTimerLabel(room, now);
  const countdownLabel = getCountdownLabel(room, now);
  const self = room?.players.find((player) => player.participantId === participantId) ?? null;
  const correctCount = room?.players.filter((player) => player.answeredCorrectly).length ?? 0;
  const visibleSearchResults = room?.status === "round_active" && deferredGuessQuery.trim() ? searchResults : [];

  useEffect(() => {
    const handle = window.setInterval(() => {
      setNow(Date.now());
    }, 250);

    return () => {
      window.clearInterval(handle);
    };
  }, []);

  const applyRoomSnapshot = useCallback((snapshot: RoomSnapshot) => {
    setRoom(snapshot);
    if (snapshot.status !== "round_active") {
      setGuessQuery("");
      setSearchResults([]);
      setGuessFeedback(null);
    }
  }, []);

  const goHome = useCallback((nextMessage?: string) => {
    if (redirectingRef.current) {
      return;
    }

    redirectingRef.current = true;
    clearRoomAuth(roomCode);
    socketRef.current?.disconnect();
    setParticipantId("");
    setParticipantToken("");
    setRoom(null);

    if (nextMessage) {
      router.push(`/?message=${encodeURIComponent(nextMessage)}`);
      return;
    }

    router.push("/");
  }, [roomCode, router]);

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      setMessage(null);
      const savedToken = localStorage.getItem(roomTokenKey(roomCode));
      const savedParticipantId = localStorage.getItem(roomParticipantKey(roomCode));

      try {
        const result = savedToken ? await reconnectRoom(roomCode, savedToken) : await joinRoom(roomCode);
        if (cancelled) {
          return;
        }

        localStorage.setItem(roomTokenKey(roomCode), result.participantToken);
        localStorage.setItem(roomParticipantKey(roomCode), result.participantId);
        setParticipantToken(result.participantToken);
        setParticipantId(result.participantId);
        applyRoomSnapshot(result.snapshot);
        setNeedsNickname(false);
      } catch (error) {
        if (cancelled) {
          return;
        }

        if (savedToken && savedParticipantId) {
          clearRoomAuth(roomCode);
        }

        const nextMessage = error instanceof Error ? error.message : "Unable to enter room.";
        if (nextMessage.toLowerCase().includes("guest session")) {
          setNeedsNickname(true);
        } else {
          setMessage(nextMessage);
          setNeedsNickname(nextMessage.toLowerCase().includes("guest"));
        }
      }
    }

    void bootstrap();

    return () => {
      cancelled = true;
    };
  }, [applyRoomSnapshot, roomCode]);

  useEffect(() => {
    if (!participantToken) {
      return;
    }

    const socket = io({
      transports: ["websocket"]
    });

    socketRef.current = socket;

    socket.on("room:snapshot", (snapshot: RoomSnapshot) => {
      applyRoomSnapshot(snapshot);
    });

    socket.on("room:closed", (payload: { reason: RoomClosedReason }) => {
      goHome(getRoomClosedMessage(payload.reason));
    });

    socket.on("round:guessResult", (feedback: GuessFeedback) => {
      setGuessFeedback(feedback);
      if (feedback.status === "correct") {
        setGuessQuery("");
        setSearchResults([]);
      }
    });

    socket.on("connect", () => {
      socket.emit("room:watch", { roomCode, participantToken }, (response: SnapshotAck) => {
        if (!response.ok) {
          setMessage(response.error ?? "Unable to watch room.");
          return;
        }

        if (response.snapshot) {
          applyRoomSnapshot(response.snapshot);
        }
      });
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [applyRoomSnapshot, goHome, participantToken, roomCode]);

  useEffect(() => {
    let cancelled = false;

    if (!deferredGuessQuery.trim() || room?.status !== "round_active") {
      return;
    }

    const handle = window.setTimeout(async () => {
      const results = await searchPlayers(deferredGuessQuery.trim());
      if (!cancelled) {
        setSearchResults(results);
      }
    }, 150);

    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [deferredGuessQuery, room?.status]);

  function saveRoomAuth(result: JoinResponse) {
    localStorage.setItem(roomTokenKey(roomCode), result.participantToken);
    localStorage.setItem(roomParticipantKey(roomCode), result.participantId);
    setParticipantToken(result.participantToken);
    setParticipantId(result.participantId);
    applyRoomSnapshot(result.snapshot);
    setNeedsNickname(false);
  }

  async function emitWithAck<T extends { ok: boolean; error?: string }>(event: string, payload: unknown): Promise<T> {
    return new Promise((resolve) => {
      if (!socketRef.current) {
        resolve({ ok: false, error: "Realtime connection unavailable." } as T);
        return;
      }

      socketRef.current.emit(event, payload, (response: T) => {
        resolve(response);
      });
    });
  }

  function submitNicknameAndJoin() {
    setMessage(null);
    startTransition(async () => {
      try {
        const trimmed = nickname.trim();
        if (trimmed.length < 2) {
          throw new Error("Nickname must be at least 2 characters.");
        }

        localStorage.setItem("guess-the-player:nickname", trimmed);
        await requestGuestSession(trimmed);
        const result = await joinRoom(roomCode);
        saveRoomAuth(result);
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Unable to join room.");
      }
    });
  }

  function updateSettings(nextSettings: Partial<RoomSettings>) {
    if (!participantId) {
      return;
    }

    startTransition(async () => {
      const response = await emitWithAck<SnapshotAck>("room:updateSettings", {
        roomCode,
        participantId,
        settings: nextSettings
      });

      if (!response.ok) {
        setMessage(response.error ?? "Unable to update settings.");
      }
    });
  }

  function startGame() {
    if (!participantId) {
      return;
    }

    startTransition(async () => {
      const response = await emitWithAck<SnapshotAck>("room:start", {
        roomCode,
        participantId
      });

      if (!response.ok) {
        setMessage(response.error ?? "Unable to start game.");
      }
    });
  }

  function submitGuess(playerId: string) {
    if (!participantId) {
      return;
    }

    socketRef.current?.emit(
      "round:guess",
      {
        roomCode,
        participantId,
        playerId
      },
      (response: { ok: boolean; error?: string }) => {
        if (!response.ok) {
          setMessage(response.error ?? "Guess failed.");
        }
      }
    );
  }

  function continueFlow() {
    if (!participantId) {
      return;
    }

    startTransition(async () => {
      const response = await emitWithAck<SnapshotAck>("round:continue", {
        roomCode,
        participantId
      });

      if (!response.ok) {
        setMessage(response.error ?? "Unable to continue.");
      }
    });
  }

  function endNoTimerRound() {
    if (!participantId) {
      return;
    }

    startTransition(async () => {
      const response = await emitWithAck<SnapshotAck>("round:endManual", {
        roomCode,
        participantId
      });

      if (!response.ok) {
        setMessage(response.error ?? "Unable to end round.");
      }
    });
  }

  function leaveGame(intent: LeaveIntent) {
    if (!participantId) {
      goHome();
      return;
    }

    startTransition(async () => {
      const response = await emitWithAck<LeaveAck>("room:leave", {
        roomCode,
        participantId,
        intent
      });

      if (!response.ok) {
        setMessage(response.error ?? "Unable to leave the room.");
        return;
      }

      setLeaveDialogOpen(false);
      goHome(intent === "end_room" ? "The host ended the game." : undefined);
    });
  }

  async function shareInvite() {
    if (!room) {
      return;
    }

    try {
      if (navigator.share) {
        await navigator.share({
          title: "Guess the Player",
          text: "Join my NFL guessing room.",
          url: room.inviteUrl
        });
      } else {
        await navigator.clipboard.writeText(room.inviteUrl);
        setMessage("Invite link copied to clipboard.");
      }
    } catch {
      setMessage("Unable to share link.");
    }
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-4 px-4 py-4 sm:px-6 sm:py-6">
      <div className="glass-panel rounded-[1.5rem] px-4 py-4 sm:px-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <Link href="/" className="text-xs font-semibold uppercase tracking-[0.24em] text-sky-700">
              Guess The Player
            </Link>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <h1 className="text-3xl font-semibold text-slate-950 sm:text-4xl">Room {roomCode}</h1>
              {room ? (
                <span className="rounded-full border border-sky-100 bg-sky-50 px-3 py-1 text-sm font-medium text-slate-700">
                  {room.players.length}/{room.settings.maxPlayers} players
                </span>
              ) : null}
            </div>
          </div>

          {room && !needsNickname ? (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={shareInvite}
                className="rounded-full border border-sky-200 bg-sky-50 px-4 py-2 text-sm font-semibold text-slate-900 transition hover:bg-sky-100"
              >
                Invite
              </button>
              <button
                type="button"
                onClick={() => setLeaveDialogOpen(true)}
                className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-900 transition hover:bg-slate-50"
              >
                Leave Game
              </button>
            </div>
          ) : null}
        </div>
      </div>

      {message ? (
        <div className="rounded-[1.2rem] border border-sky-200 bg-white px-4 py-3 text-sm text-slate-900">{message}</div>
      ) : null}

      {needsNickname ? (
        <section className="glass-panel mx-auto w-full max-w-xl rounded-[1.5rem] p-5 sm:p-7">
          <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Join This Room</p>
          <h2 className="mt-2 text-3xl font-semibold text-slate-950">Pick a nickname.</h2>
          <input
            value={nickname}
            onChange={(event) => setNickname(event.target.value)}
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
            <>
              <div className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
                <div className="glass-panel rounded-[1.5rem] p-5 sm:p-6">
                  <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Lobby</p>
                  <h2 className="mt-2 text-3xl font-semibold text-slate-950">Match settings</h2>

                  <div className="mt-6 grid gap-4 sm:grid-cols-2">
                    <label className="rounded-[1.25rem] border border-slate-200 bg-white p-4 text-sm text-slate-700">
                      <span className="block text-xs uppercase tracking-[0.2em] text-slate-500">Rounds</span>
                      <input
                        type="number"
                        min={1}
                        max={20}
                        value={room.settings.roundCount}
                        disabled={!self?.isHost}
                        onChange={(event) => updateSettings({ roundCount: Number(event.target.value) })}
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
                      <span className="block text-xs uppercase tracking-[0.2em] text-slate-500">Mode</span>
                      <select
                        value={room.settings.mode}
                        disabled={!self?.isHost}
                        onChange={(event) => updateSettings({ mode: event.target.value as RoomSettings["mode"] })}
                        className="mt-3 w-full rounded-[0.9rem] border border-slate-200 bg-slate-50 px-3 py-2 outline-none focus:border-sky-300 disabled:opacity-60"
                      >
                        <option value="kahoot">Kahoot style</option>
                        <option value="sudden_death">Sudden death</option>
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

                  <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-sm text-slate-600">
                      {room.canStart ? "Ready to start." : "Need 2+ players and enough eligible players."}
                    </p>
                    {self?.isHost ? (
                      <button
                        type="button"
                        disabled={!room.canStart || pending}
                        onClick={startGame}
                        className="rounded-full bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Start Game
                      </button>
                    ) : (
                      <div className="rounded-full border border-sky-100 bg-sky-50 px-4 py-2 text-sm text-slate-600">
                        Waiting for the host to start.
                      </div>
                    )}
                  </div>
                </div>

                <PlayerRosterCard room={room} participantId={participantId} title="Players" subtitle="Room" />
              </div>
            </>
          ) : null}

          {room.status === "countdown" ? (
            <>
              <div className="glass-panel rounded-[1.5rem] px-5 py-8 text-center sm:px-8 sm:py-10">
                <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Round {room.round?.roundNumber}</p>
                <div className="mt-5 text-7xl font-semibold leading-none text-slate-950 sm:text-8xl">{countdownLabel}</div>
                <p className="mt-4 text-base text-slate-600">Get ready.</p>
              </div>
              <PlayerRosterCard room={room} participantId={participantId} title="Players" subtitle="Countdown" />
            </>
          ) : null}

          {room.status === "round_active" ? (
            <>
              <div className="glass-panel rounded-[1.5rem] p-5 sm:p-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-[0.24em] text-slate-500">
                      Round {room.round?.roundNumber} of {room.round?.totalRounds}
                    </p>
                    <h2 className="mt-2 text-3xl font-semibold text-slate-950">Guess the player.</h2>
                    <p className="mt-2 text-sm text-slate-600">
                      {correctCount}/{room.players.length} players solved so far.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <div className="rounded-full border border-sky-100 bg-sky-50 px-4 py-2 text-sm font-semibold text-slate-700">
                      {timerLabel === null ? "No timer" : `${timerLabel}s`}
                    </div>
                    {room.settings.timePerRoundSeconds === null && self?.isHost ? (
                      <button
                        type="button"
                        onClick={endNoTimerRound}
                        className="rounded-full border border-sky-200 bg-sky-50 px-4 py-2 text-sm font-semibold text-sky-800"
                      >
                        Reveal
                      </button>
                    ) : null}
                  </div>
                </div>

                <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {room.round?.teamStints.map((stint, index) => {
                    const team = NFL_TEAMS[stint.teamId];

                    return (
                      <article
                        key={`${stint.teamId}-${index}-${stint.startYear}`}
                        className="rounded-[1.2rem] border border-slate-200 bg-white p-4"
                      >
                        <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Stop {index + 1}</p>
                        <h3 className="mt-2 text-xl font-semibold text-slate-950">{formatTeamLabel(stint.teamId)}</h3>
                        <p className="mt-1 text-sm text-slate-600">{stint.teamId}</p>
                        {room.settings.showYears ? (
                          <p className="mt-4 text-sm font-medium text-slate-800">{formatYearRange(stint.startYear, stint.endYear)}</p>
                        ) : null}
                        <div className="mt-4 h-2 rounded-full" style={{ backgroundColor: team.primary }} />
                      </article>
                    );
                  })}
                </div>
              </div>

              <div className="grid gap-4 lg:grid-cols-[0.78fr_1.22fr]">
                <PlayerRosterCard room={room} participantId={participantId} title="Players" subtitle="Live status" />

                <div className="glass-panel rounded-[1.5rem] p-5 sm:p-6">
                  <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Answer</p>
                  <h3 className="mt-2 text-2xl font-semibold text-slate-950">Search and submit.</h3>

                  <div className="mt-5">
                    <input
                      value={guessQuery}
                      onChange={(event) => {
                        const nextValue = event.target.value;
                        setGuessQuery(nextValue);
                        if (!nextValue.trim()) {
                          setSearchResults([]);
                        }
                      }}
                      disabled={self?.answeredCorrectly}
                      placeholder={self?.answeredCorrectly ? "You already solved it." : "Search player names"}
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

                    <div className="mt-3 grid gap-2">
                      {visibleSearchResults.map((result) => (
                        <button
                          key={result.id}
                          type="button"
                          onClick={() => submitGuess(result.id)}
                          className="rounded-[1rem] border border-slate-200 bg-white px-4 py-3 text-left text-sm font-medium text-slate-800 transition hover:bg-slate-50"
                        >
                          {result.fullName}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </>
          ) : null}

          {room.status === "round_reveal" && room.round?.reveal ? (
            <div className="glass-panel rounded-[1.5rem] p-5 sm:p-6">
              <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Reveal</p>
              <div className="mt-5 grid gap-6 lg:grid-cols-[240px_1fr] lg:items-start">
                <div className="overflow-hidden rounded-[1.4rem] border border-slate-200 bg-slate-50">
                  <Image
                    src={room.round.reveal.player.headshotUrl}
                    alt={room.round.reveal.player.fullName}
                    width={320}
                    height={320}
                    className="h-auto w-full object-cover"
                    unoptimized
                  />
                </div>

                <div>
                  <p className="text-sm font-semibold uppercase tracking-[0.2em] text-sky-700">Answer</p>
                  <h2 className="mt-2 text-4xl font-semibold text-slate-950">{room.round.reveal.player.fullName}</h2>
                  <div className="mt-5 grid gap-3 md:grid-cols-2">
                    {room.round.reveal.player.teamStints.map((stint, index) => {
                      const team = NFL_TEAMS[stint.teamId];

                      return (
                        <div key={`${stint.teamId}-${index}-${stint.startYear}`} className="rounded-[1.1rem] border border-slate-200 bg-white p-4">
                          <p className="font-semibold text-slate-950">{formatTeamLabel(stint.teamId)}</p>
                          <p className="mt-1 text-sm text-slate-600">{formatYearRange(stint.startYear, stint.endYear)}</p>
                          <div className="mt-3 h-2 rounded-full" style={{ backgroundColor: team.primary }} />
                        </div>
                      );
                    })}
                  </div>

                  <div className="mt-6">
                    {self?.isHost ? (
                      <button
                        type="button"
                        disabled={pending}
                        onClick={continueFlow}
                        className="rounded-full bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Continue to Leaderboard
                      </button>
                    ) : (
                      <div className="rounded-full border border-sky-100 bg-sky-50 px-4 py-2 text-sm text-slate-600">
                        Waiting for the host.
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
          pending={pending}
          onClose={() => setLeaveDialogOpen(false)}
          onLeave={() => leaveGame("leave")}
          onEndRoom={() => leaveGame("end_room")}
        />
      ) : null}
    </main>
  );
}
