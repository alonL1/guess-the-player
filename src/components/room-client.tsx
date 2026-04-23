"use client";

import clsx from "clsx";
import Image from "next/image";
import Link from "next/link";
import { useDeferredValue, useEffect, useRef, useState, useTransition } from "react";
import { io, type Socket } from "socket.io-client";

import { NFL_TEAMS, formatTeamLabel } from "@/lib/nfl-teams";
import type { Difficulty, RoomSettings, RoomSnapshot } from "@/lib/types";
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

const DIFFICULTY_OPTIONS: Difficulty[] = ["easy", "medium", "hard", "impossible"];

function roomTokenKey(roomCode: string) {
  return `guess-the-player:token:${roomCode}`;
}

function roomParticipantKey(roomCode: string) {
  return `guess-the-player:participant:${roomCode}`;
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

function getTimerLabel(room: RoomSnapshot | null, now: number) {
  if (!room?.round?.endsAt) {
    return null;
  }

  const remainingMs = new Date(room.round.endsAt).getTime() - now;
  const remainingSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
  return remainingSeconds;
}

function getCountdownLabel(room: RoomSnapshot | null, now: number) {
  if (!room?.round?.countdownEndsAt) {
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

export function RoomClient({ roomCode }: { roomCode: string }) {
  const socketRef = useRef<Socket | null>(null);
  const [room, setRoom] = useState<RoomSnapshot | null>(null);
  const [participantId, setParticipantId] = useState("");
  const [participantToken, setParticipantToken] = useState("");
  const [nickname, setNickname] = useState("");
  const [needsNickname, setNeedsNickname] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [guessQuery, setGuessQuery] = useState("");
  const deferredGuessQuery = useDeferredValue(guessQuery);
  const [searchResults, setSearchResults] = useState<Array<{ id: string; fullName: string }>>([]);
  const [guessFeedback, setGuessFeedback] = useState<GuessFeedback | null>(null);
  const [now, setNow] = useState(Date.now());
  const [pending, startTransition] = useTransition();

  const timerLabel = getTimerLabel(room, now);
  const countdownLabel = getCountdownLabel(room, now);
  const self = room?.players.find((player) => player.participantId === participantId) ?? null;
  const scoreboard = sortPlayersForBoard(room);

  useEffect(() => {
    const rememberedNickname = localStorage.getItem("guess-the-player:nickname");
    if (rememberedNickname) {
      setNickname(rememberedNickname);
    }
  }, []);

  useEffect(() => {
    const handle = window.setInterval(() => {
      setNow(Date.now());
    }, 250);

    return () => {
      window.clearInterval(handle);
    };
  }, []);

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
        setRoom(result.snapshot);
        setNeedsNickname(false);
      } catch (error) {
        if (cancelled) {
          return;
        }

        if (savedToken && savedParticipantId) {
          localStorage.removeItem(roomTokenKey(roomCode));
          localStorage.removeItem(roomParticipantKey(roomCode));
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
  }, [roomCode]);

  useEffect(() => {
    if (!participantToken) {
      return;
    }

    const socket = io({
      transports: ["websocket"]
    });

    socketRef.current = socket;

    socket.on("room:snapshot", (snapshot: RoomSnapshot) => {
      setRoom(snapshot);
    });

    socket.on("round:guessResult", (feedback: GuessFeedback) => {
      setGuessFeedback(feedback);
      if (feedback.status === "correct") {
        setGuessQuery("");
        setSearchResults([]);
      }
    });

    socket.on("connect", () => {
      socket.emit("room:watch", { roomCode, participantToken }, (response: { ok: boolean; error?: string; snapshot?: RoomSnapshot }) => {
        if (!response.ok) {
          setMessage(response.error ?? "Unable to watch room.");
          return;
        }

        if (response.snapshot) {
          setRoom(response.snapshot);
        }
      });
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [participantToken, roomCode]);

  useEffect(() => {
    let cancelled = false;

    if (!deferredGuessQuery.trim() || room?.status !== "round_active") {
      setSearchResults([]);
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
    setRoom(result.snapshot);
    setNeedsNickname(false);
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

  function emitWithAck(event: string, payload: unknown) {
    return new Promise<{ ok: boolean; error?: string; snapshot?: RoomSnapshot }>((resolve) => {
      socketRef.current?.emit(event, payload, (response: { ok: boolean; error?: string; snapshot?: RoomSnapshot }) => {
        resolve(response);
      });
    });
  }

  function updateSettings(nextSettings: Partial<RoomSettings>) {
    if (!participantId) {
      return;
    }

    startTransition(async () => {
      const response = await emitWithAck("room:updateSettings", {
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
      const response = await emitWithAck("room:start", {
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
      (response: { ok: boolean; error?: string; result?: GuessFeedback }) => {
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
      const response = await emitWithAck("round:continue", {
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
      const response = await emitWithAck("round:endManual", {
        roomCode,
        participantId
      });

      if (!response.ok) {
        setMessage(response.error ?? "Unable to end round.");
      }
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
    <main className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-6 px-4 py-5 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <Link href="/" className="text-sm uppercase tracking-[0.28em] text-slate-300/70">
            Guess The Player
          </Link>
          <h1 className="display-font mt-2 text-3xl font-semibold sm:text-4xl">Room {roomCode}</h1>
        </div>
        {room ? (
          <div className="flex flex-wrap items-center gap-3">
            <div className="rounded-full border border-white/10 bg-white/6 px-4 py-2 text-sm text-slate-200/80">
              {room.players.length}/{room.settings.maxPlayers} players
            </div>
            <button
              type="button"
              onClick={shareInvite}
              className="rounded-full border border-white/12 bg-white/8 px-4 py-2 text-sm font-medium text-white transition hover:bg-white/12"
            >
              Invite
            </button>
          </div>
        ) : null}
      </div>

      {message ? (
        <div className="rounded-3xl border border-white/10 bg-white/6 px-4 py-3 text-sm text-slate-200/85">{message}</div>
      ) : null}

      {needsNickname ? (
        <section className="glass-panel mx-auto mt-8 w-full max-w-xl rounded-[1.8rem] p-6 sm:p-8">
          <p className="text-sm uppercase tracking-[0.28em] text-slate-300/70">Join This Room</p>
          <h2 className="display-font mt-2 text-3xl font-semibold">Pick a nickname to enter.</h2>
          <input
            value={nickname}
            onChange={(event) => setNickname(event.target.value)}
            placeholder="Sunday Sniper"
            className="mt-5 w-full rounded-2xl border border-white/10 bg-slate-950/55 px-4 py-3 outline-none transition focus:border-orange-300/55"
          />
          <button
            type="button"
            disabled={pending}
            onClick={submitNicknameAndJoin}
            className="mt-4 w-full rounded-2xl bg-[linear-gradient(135deg,#ff7a18,#ff9b47)] px-4 py-3 font-medium text-slate-950 disabled:cursor-not-allowed disabled:opacity-70"
          >
            Join Room
          </button>
        </section>
      ) : null}

      {!needsNickname && !room ? (
        <section className="glass-panel rounded-[1.8rem] p-8 text-center text-slate-300/80">Loading room...</section>
      ) : null}

      {!needsNickname && room ? (
        <div className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
          <aside className="glass-panel rounded-[1.8rem] p-5 sm:p-6">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.28em] text-slate-400/70">Lobby + Scores</p>
                <h2 className="display-font mt-1 text-2xl font-semibold">Standings</h2>
              </div>
              {room.status === "countdown" ? (
                <span className="rounded-full bg-orange-400/15 px-3 py-1 text-sm font-medium text-orange-100">
                  Starting in {countdownLabel}
                </span>
              ) : null}
            </div>

            <div className="mt-5 space-y-3">
              {scoreboard.map((player, index) => (
                <div
                  key={player.participantId}
                  className={clsx(
                    "rounded-3xl border px-4 py-4 transition",
                    player.participantId === participantId ? "border-orange-300/40 bg-orange-300/10" : "border-white/8 bg-white/5"
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm uppercase tracking-[0.18em] text-slate-400/70">#{index + 1}</p>
                      <div className="mt-1 flex items-center gap-2">
                        <span className="text-lg font-medium">{player.nickname}</span>
                        {player.isHost ? (
                          <span className="rounded-full border border-white/12 bg-white/8 px-2 py-0.5 text-xs uppercase tracking-[0.2em] text-slate-100/85">
                            Host
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-1 text-sm text-slate-400/80">
                        {player.connected ? "Connected" : "Disconnected"}
                        {player.answeredCorrectly ? " • Correct this round" : ""}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-2xl font-semibold text-white">{player.score}</p>
                      <p className="text-xs uppercase tracking-[0.2em] text-slate-400/70">Points</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {self ? (
              <div className="mt-5 rounded-3xl border border-white/8 bg-white/4 px-4 py-4 text-sm text-slate-300/85">
                {guessFeedback ? (
                  <p>
                    {guessFeedback.message}
                    {typeof guessFeedback.currentCap === "number" ? ` Max remaining: ${guessFeedback.currentCap}` : ""}
                    {typeof guessFeedback.score === "number" ? ` Score: ${guessFeedback.score}` : ""}
                  </p>
                ) : (
                  <p>
                    {room.status === "lobby"
                      ? "Waiting in the lobby."
                      : room.status === "round_active"
                        ? "Track the timeline, search fast, and lock the answer."
                        : "Watch the round flow from reveal to leaderboard."}
                  </p>
                )}
              </div>
            ) : null}
          </aside>

          <section className="space-y-6">
            {room.status === "lobby" ? (
              <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
                <div className="glass-panel rounded-[1.8rem] p-5 sm:p-6">
                  <p className="text-xs uppercase tracking-[0.28em] text-slate-400/70">Room Controls</p>
                  <h2 className="display-font mt-2 text-3xl font-semibold">Set the match.</h2>
                  <p className="mt-3 max-w-2xl text-sm text-slate-300/75">
                    The host controls rounds, timing, difficulty filters, sudden death, and year labels.
                  </p>
                  <div className="mt-6 grid gap-4 sm:grid-cols-2">
                    <label className="rounded-3xl border border-white/8 bg-white/5 p-4 text-sm text-slate-200/85">
                      <span className="block text-xs uppercase tracking-[0.22em] text-slate-400/70">Rounds</span>
                      <input
                        type="number"
                        min={1}
                        max={20}
                        value={room.settings.roundCount}
                        disabled={!self?.isHost}
                        onChange={(event) => updateSettings({ roundCount: Number(event.target.value) })}
                        className="mt-3 w-full rounded-2xl border border-white/8 bg-slate-950/55 px-3 py-2 disabled:opacity-60"
                      />
                    </label>

                    <label className="rounded-3xl border border-white/8 bg-white/5 p-4 text-sm text-slate-200/85">
                      <span className="block text-xs uppercase tracking-[0.22em] text-slate-400/70">Timer</span>
                      <select
                        value={room.settings.timePerRoundSeconds === null ? "none" : String(room.settings.timePerRoundSeconds)}
                        disabled={!self?.isHost}
                        onChange={(event) =>
                          updateSettings({
                            timePerRoundSeconds: event.target.value === "none" ? null : Number(event.target.value)
                          })
                        }
                        className="mt-3 w-full rounded-2xl border border-white/8 bg-slate-950/55 px-3 py-2 disabled:opacity-60"
                      >
                        <option value="none">No timer</option>
                        <option value="15">15 seconds</option>
                        <option value="30">30 seconds</option>
                        <option value="45">45 seconds</option>
                        <option value="60">60 seconds</option>
                      </select>
                    </label>

                    <label className="rounded-3xl border border-white/8 bg-white/5 p-4 text-sm text-slate-200/85">
                      <span className="block text-xs uppercase tracking-[0.22em] text-slate-400/70">Mode</span>
                      <select
                        value={room.settings.mode}
                        disabled={!self?.isHost}
                        onChange={(event) => updateSettings({ mode: event.target.value as RoomSettings["mode"] })}
                        className="mt-3 w-full rounded-2xl border border-white/8 bg-slate-950/55 px-3 py-2 disabled:opacity-60"
                      >
                        <option value="kahoot">Kahoot style</option>
                        <option value="sudden_death">Sudden death</option>
                      </select>
                    </label>

                    <label className="rounded-3xl border border-white/8 bg-white/5 p-4 text-sm text-slate-200/85">
                      <span className="block text-xs uppercase tracking-[0.22em] text-slate-400/70">Years under teams</span>
                      <button
                        type="button"
                        disabled={!self?.isHost}
                        onClick={() => updateSettings({ showYears: !room.settings.showYears })}
                        className={clsx(
                          "mt-3 inline-flex w-full items-center justify-between rounded-2xl border px-3 py-2 text-left disabled:opacity-60",
                          room.settings.showYears
                            ? "border-emerald-300/35 bg-emerald-300/12 text-emerald-50"
                            : "border-white/8 bg-slate-950/55 text-slate-200"
                        )}
                      >
                        <span>{room.settings.showYears ? "Showing years" : "Hidden"}</span>
                        <span>{room.settings.showYears ? "On" : "Off"}</span>
                      </button>
                    </label>
                  </div>

                  <div className="mt-4 rounded-[1.5rem] border border-white/8 bg-white/4 p-4">
                    <p className="text-xs uppercase tracking-[0.22em] text-slate-400/70">Difficulty</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {DIFFICULTY_OPTIONS.map((difficulty) => {
                        const active = room.settings.difficulty.includes(difficulty);
                        return (
                          <button
                            key={difficulty}
                            type="button"
                            disabled={!self?.isHost}
                            onClick={() => {
                              const next = active
                                ? room.settings.difficulty.filter((value) => value !== difficulty)
                                : [...room.settings.difficulty, difficulty];
                              updateSettings({ difficulty: next });
                            }}
                            className={clsx(
                              "rounded-full border px-3 py-2 text-sm font-medium capitalize transition disabled:opacity-60",
                              active
                                ? "border-orange-300/40 bg-orange-300/14 text-orange-50"
                                : "border-white/10 bg-white/4 text-slate-200"
                            )}
                          >
                            {difficulty}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="mt-6 flex flex-wrap items-center justify-between gap-4">
                    <div className="text-sm text-slate-300/75">
                      {room.canStart ? "Ready to start." : "Need 2+ players and enough eligible players for the chosen settings."}
                    </div>
                    {self?.isHost ? (
                      <button
                        type="button"
                        disabled={!room.canStart || pending}
                        onClick={startGame}
                        className="rounded-2xl bg-[linear-gradient(135deg,#ff7a18,#ff9b47)] px-5 py-3 font-medium text-slate-950 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Start Game
                      </button>
                    ) : (
                      <div className="rounded-2xl border border-white/8 bg-white/6 px-4 py-3 text-sm text-slate-200/80">
                        Waiting for the host to start.
                      </div>
                    )}
                  </div>
                </div>

                <div className="glass-panel rounded-[1.8rem] p-5 sm:p-6">
                  <p className="text-xs uppercase tracking-[0.28em] text-slate-400/70">How It Works</p>
                  <h2 className="display-font mt-2 text-3xl font-semibold">Race the timeline.</h2>
                  <ol className="mt-5 space-y-4 text-sm text-slate-200/85">
                    <li className="rounded-3xl border border-white/8 bg-white/5 px-4 py-4">
                      1. A hidden NFL player is picked from the filtered difficulty pool.
                    </li>
                    <li className="rounded-3xl border border-white/8 bg-white/5 px-4 py-4">
                      2. Everyone sees the ordered list of teams the player has been on.
                    </li>
                    <li className="rounded-3xl border border-white/8 bg-white/5 px-4 py-4">
                      3. Search and select the player name. Wrong guesses lower only your round ceiling.
                    </li>
                    <li className="rounded-3xl border border-white/8 bg-white/5 px-4 py-4">
                      4. After reveal, the leaderboard updates and the host drives the next round.
                    </li>
                  </ol>
                </div>
              </div>
            ) : null}

            {room.status === "countdown" ? (
              <div className="glass-panel rounded-[2rem] p-8 text-center sm:p-12">
                <p className="text-xs uppercase tracking-[0.3em] text-slate-300/70">Round {room.round?.roundNumber}</p>
                <div className="display-font mt-6 text-[7rem] font-semibold leading-none text-white sm:text-[9rem]">{countdownLabel}</div>
                <p className="mt-5 text-lg text-slate-200/80">Memorize the order. Everyone sees the teams at the same moment.</p>
              </div>
            ) : null}

            {room.status === "round_active" ? (
              <div className="space-y-6">
                <div className="glass-panel rounded-[1.8rem] p-5 sm:p-6">
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <div>
                      <p className="text-xs uppercase tracking-[0.28em] text-slate-400/70">
                        Round {room.round?.roundNumber} of {room.round?.totalRounds}
                      </p>
                      <h2 className="display-font mt-2 text-3xl font-semibold">Guess the hidden NFL player.</h2>
                    </div>
                    <div className="rounded-full border border-white/10 bg-white/6 px-4 py-2 text-lg font-semibold">
                      {timerLabel === null ? "No timer" : `${timerLabel}s`}
                    </div>
                  </div>

                  <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {room.round?.teamStints.map((stint, index) => {
                      const team = NFL_TEAMS[stint.teamId];
                      return (
                        <article
                          key={`${stint.teamId}-${index}-${stint.startYear}`}
                          className="rounded-[1.5rem] border border-white/8 p-4"
                          style={{
                            background: `linear-gradient(145deg, ${team.primary}55, ${team.secondary}26)`
                          }}
                        >
                          <p className="text-xs uppercase tracking-[0.24em] text-white/70">Stop {index + 1}</p>
                          <h3 className="mt-2 text-xl font-semibold text-white">{formatTeamLabel(stint.teamId)}</h3>
                          <p className="mt-1 text-sm text-white/80">{stint.teamId}</p>
                          {room.settings.showYears ? (
                            <p className="mt-4 text-sm font-medium text-white/90">{formatYearRange(stint.startYear, stint.endYear)}</p>
                          ) : null}
                        </article>
                      );
                    })}
                  </div>
                </div>

                <div className="glass-panel rounded-[1.8rem] p-5 sm:p-6">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-xs uppercase tracking-[0.28em] text-slate-400/70">Search</p>
                      <h3 className="display-font mt-2 text-2xl font-semibold">Lock your answer.</h3>
                    </div>
                    {room.settings.timePerRoundSeconds === null && self?.isHost ? (
                      <button
                        type="button"
                        onClick={endNoTimerRound}
                        className="rounded-full border border-amber-300/30 bg-amber-300/12 px-4 py-2 text-sm font-medium text-amber-50"
                      >
                        Reveal Answer
                      </button>
                    ) : null}
                  </div>

                  <div className="mt-5">
                    <input
                      value={guessQuery}
                      onChange={(event) => setGuessQuery(event.target.value)}
                      disabled={self?.answeredCorrectly}
                      placeholder={self?.answeredCorrectly ? "You already solved it." : "Search player names"}
                      className="w-full rounded-2xl border border-white/10 bg-slate-950/55 px-4 py-3 outline-none transition focus:border-orange-300/55 disabled:opacity-60"
                    />
                    <div className="mt-3 grid gap-2">
                      {searchResults.map((result) => (
                        <button
                          key={result.id}
                          type="button"
                          onClick={() => submitGuess(result.id)}
                          className="rounded-2xl border border-white/8 bg-white/5 px-4 py-3 text-left text-sm text-slate-100 transition hover:bg-white/10"
                        >
                          {result.fullName}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            ) : null}

            {(room.status === "round_reveal" || room.status === "round_leaderboard" || room.status === "finished") && room.round?.reveal ? (
              <div className="space-y-6">
                {room.status === "round_reveal" ? (
                  <div className="glass-panel rounded-[2rem] p-6 sm:p-8">
                    <p className="text-xs uppercase tracking-[0.28em] text-slate-400/70">Reveal</p>
                    <div className="mt-5 grid gap-6 lg:grid-cols-[280px_1fr] lg:items-start">
                      <div className="overflow-hidden rounded-[1.7rem] border border-white/10 bg-white/5">
                        <Image
                          src={room.round.reveal.player.headshotUrl}
                          alt={room.round.reveal.player.fullName}
                          width={280}
                          height={280}
                          className="h-auto w-full object-cover"
                          unoptimized
                        />
                      </div>
                      <div>
                        <p className="text-sm uppercase tracking-[0.28em] text-orange-200/75">Hidden player</p>
                        <h2 className="display-font mt-2 text-4xl font-semibold">{room.round.reveal.player.fullName}</h2>
                        <div className="mt-5 grid gap-3 sm:grid-cols-2">
                          {room.round.reveal.player.teamStints.map((stint, index) => {
                            const team = NFL_TEAMS[stint.teamId];
                            return (
                              <div key={`${stint.teamId}-${index}-${stint.startYear}`} className="rounded-3xl border border-white/8 bg-white/5 p-4">
                                <p className="font-medium text-white">{formatTeamLabel(stint.teamId)}</p>
                                <p className="mt-1 text-sm text-slate-300/75">
                                  {formatYearRange(stint.startYear, stint.endYear)}
                                </p>
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
                              className="rounded-2xl bg-[linear-gradient(135deg,#ff7a18,#ff9b47)] px-5 py-3 font-medium text-slate-950 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              Continue
                            </button>
                          ) : (
                            <div className="rounded-2xl border border-white/8 bg-white/5 px-4 py-3 text-sm text-slate-200/80">
                              Waiting for the host to continue.
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ) : null}

                {room.status === "round_leaderboard" || room.status === "finished" ? (
                  <div className="glass-panel rounded-[2rem] p-6 sm:p-8">
                    <div className="flex flex-wrap items-center justify-between gap-4">
                      <div>
                        <p className="text-xs uppercase tracking-[0.28em] text-slate-400/70">
                          {room.status === "finished" ? "Final leaderboard" : "Leaderboard"}
                        </p>
                        <h2 className="display-font mt-2 text-4xl font-semibold">
                          {room.status === "finished" ? "Match complete." : "Round results."}
                        </h2>
                      </div>
                      {self?.isHost ? (
                        <button
                          type="button"
                          disabled={pending}
                          onClick={continueFlow}
                          className="rounded-2xl bg-[linear-gradient(135deg,#ff7a18,#ff9b47)] px-5 py-3 font-medium text-slate-950 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {room.status === "finished" ? "Back to Lobby" : "Next Round"}
                        </button>
                      ) : (
                        <div className="rounded-2xl border border-white/8 bg-white/5 px-4 py-3 text-sm text-slate-200/80">
                          Waiting for the host.
                        </div>
                      )}
                    </div>

                    <div className="mt-6 space-y-3">
                      {scoreboard.map((player, index) => (
                        <div key={player.participantId} className="rounded-3xl border border-white/8 bg-white/5 px-4 py-4">
                          <div className="flex items-center justify-between gap-4">
                            <div>
                              <p className="text-xs uppercase tracking-[0.22em] text-slate-400/70">#{index + 1}</p>
                              <p className="mt-1 text-xl font-semibold">{player.nickname}</p>
                              <p className="mt-1 text-sm text-slate-300/70">
                                Round score: {room.round?.reveal?.roundScores[player.participantId] ?? 0}
                              </p>
                            </div>
                            <p className="text-3xl font-semibold">{player.score}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
          </section>
        </div>
      ) : null}
    </main>
  );
}
