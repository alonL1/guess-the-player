import { useEffect, useState, useTransition } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { getNickname, getOrCreateSessionId, setNickname as persistNickname } from "@/lib/session";

const PARTYKIT_HOST = import.meta.env.VITE_PARTYKIT_HOST || "127.0.0.1:1999";

function partyHttp(path: string) {
  const proto = PARTYKIT_HOST.startsWith("localhost") || PARTYKIT_HOST.startsWith("127.") ? "http" : "https";
  return `${proto}://${PARTYKIT_HOST}${path}`;
}

function createRoomCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

type LobbyEntry = {
  roomCode: string;
  playerCount: number;
  maxPlayers: number;
  hostConnected: boolean;
  updatedAt: number;
};

async function fetchOpenRooms(): Promise<LobbyEntry[]> {
  try {
    const response = await fetch(partyHttp("/parties/lobby/global"));
    if (!response.ok) return [];
    const body = (await response.json()) as { rooms?: LobbyEntry[] };
    return body.rooms ?? [];
  } catch {
    return [];
  }
}

function pickBestOpenRoom(rooms: LobbyEntry[]): LobbyEntry | null {
  const open = rooms.filter((r) => r.playerCount < r.maxPlayers);
  if (open.length === 0) return null;
  // Prefer rooms with a connected host; fall back to host-disconnected rooms
  // only if there are no host-connected options available.
  const withHost = open.filter((r) => r.hostConnected);
  const pool = withHost.length > 0 ? withHost : open;
  pool.sort((a, b) => {
    if (b.playerCount !== a.playerCount) return b.playerCount - a.playerCount;
    return a.updatedAt - b.updatedAt;
  });
  return pool[0];
}

export function LandingPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const initialMessage = searchParams.get("message");
  const [nickname, setNicknameState] = useState(() => getNickname());
  const [message, setMessage] = useState<string | null>(initialMessage);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    // Make sure a sessionId exists for this browser
    getOrCreateSessionId();
  }, []);

  function handleAction(action: "create" | "join") {
    setMessage(null);
    startTransition(async () => {
      try {
        const trimmed = nickname.trim();
        if (trimmed.length < 2) {
          throw new Error("Pick a nickname with at least 2 characters");
        }
        if (trimmed.length > 20) {
          throw new Error("Nickname must be at most 20 characters");
        }
        persistNickname(trimmed);

        if (action === "create") {
          navigate(`/rooms/${createRoomCode()}`);
          return;
        }

        const open = await fetchOpenRooms();
        const best = pickBestOpenRoom(open);
        if (!best) {
          throw new Error("No open public rooms are available right now");
        }
        navigate(`/rooms/${best.roomCode}`);
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Something went wrong");
      }
    });
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col justify-center px-4 py-4 sm:px-6 sm:py-6">
      <section className="glass-panel rounded-[1.5rem] border border-sky-100 bg-white p-4 sm:p-8 lg:p-10">
        <div className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:gap-8">
          <div className="max-w-3xl">
            <p className="text-xs uppercase tracking-[0.24em] text-sky-700 sm:text-sm">NFL Path Guesser</p>
            <h1 className="mt-2 text-2xl font-semibold leading-tight text-slate-950 sm:text-4xl lg:text-5xl xl:text-6xl">
              Guess the player from the career path before your friends do
            </h1>
            <p className="mt-3 max-w-2xl text-sm text-slate-600 sm:mt-4 sm:text-base lg:text-lg">
              Create a room, pull in friends, or take a fast solo score run.
            </p>
          </div>

          <div className="rounded-[1.5rem] border border-sky-100 bg-sky-50/70 p-4 sm:p-6 lg:p-7">
            <p className="text-sm uppercase tracking-[0.24em] text-slate-500">Start playing</p>
            <button
              type="button"
              onClick={() => navigate("/solo")}
              className="mt-5 w-full rounded-[1rem] bg-slate-950 px-4 py-3 font-semibold text-white transition hover:bg-slate-800"
            >
              Quick Solo Play
            </button>
            <div className="my-5 h-px bg-sky-100" />
            <label className="mt-5 block text-sm text-slate-700">
              Nickname
              <input
                value={nickname}
                onChange={(event) => setNicknameState(event.target.value)}
                placeholder="Gridiron Guru"
                className="mt-2 w-full rounded-[1rem] border border-sky-100 bg-white px-4 py-3 text-base text-slate-950 outline-none transition focus:border-sky-300"
              />
            </label>
            <div className="mt-5 grid gap-3">
              <button
                type="button"
                disabled={pending}
                onClick={() => handleAction("create")}
                className="rounded-[1rem] border border-sky-200 bg-white px-4 py-3 font-semibold text-slate-900 transition hover:bg-sky-50 disabled:cursor-not-allowed disabled:opacity-70"
              >
                Create Room
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => handleAction("join")}
                className="rounded-[1rem] border border-sky-200 bg-white px-4 py-3 font-semibold text-slate-900 transition hover:bg-sky-50 disabled:cursor-not-allowed disabled:opacity-70"
              >
                Join a Room
              </button>
            </div>
            {message ? (
              <div className="mt-4 rounded-[1rem] border border-sky-200 bg-white px-4 py-3 text-sm text-slate-900">
                {message}
              </div>
            ) : null}
          </div>
        </div>
      </section>
    </main>
  );
}
