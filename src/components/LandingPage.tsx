import { useEffect, useState, useTransition } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";

import { getNickname, getOrCreateSessionId, setNickname as persistNickname } from "@/lib/session";

const PARTYKIT_HOST = import.meta.env.VITE_PARTYKIT_HOST || "127.0.0.1:1999";
const ROOM_CODE_PATTERN = /^[A-Z0-9]{6}$/;

function isLocalhost() {
  if (typeof window === "undefined") return false;
  return ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
}

function partyHttp(path: string) {
  const proto = PARTYKIT_HOST.startsWith("localhost") || PARTYKIT_HOST.startsWith("127.") ? "http" : "https";
  return `${proto}://${PARTYKIT_HOST}${path}`;
}

function createRoomCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

function normalizeRoomCode(input: string) {
  return input.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
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
  const [joinDialogOpen, setJoinDialogOpen] = useState(false);
  const [joinMode, setJoinMode] = useState<"choices" | "code">("choices");
  const [roomCode, setRoomCode] = useState("");
  const [joinMessage, setJoinMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const showLocalTools = isLocalhost();
  const normalizedRoomCode = normalizeRoomCode(roomCode);
  const roomCodeHasValidFormat = ROOM_CODE_PATTERN.test(normalizedRoomCode);

  useEffect(() => {
    // Make sure a sessionId exists for this browser
    getOrCreateSessionId();
  }, []);

  function validateNickname() {
    const trimmed = nickname.trim();
    if (trimmed.length < 2) {
      throw new Error("Pick a nickname with at least 2 characters");
    }
    if (trimmed.length > 20) {
      throw new Error("Nickname must be at most 20 characters");
    }
    persistNickname(trimmed);
  }

  function createRoom() {
    setMessage(null);
    startTransition(async () => {
      try {
        validateNickname();
        navigate(`/rooms/${createRoomCode()}`);
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Something went wrong");
      }
    });
  }

  function findRoom() {
    setMessage(null);
    setJoinMessage(null);
    startTransition(async () => {
      try {
        validateNickname();
        const open = await fetchOpenRooms();
        const best = pickBestOpenRoom(open);
        if (!best) {
          throw new Error("No open public rooms are available right now");
        }
        navigate(`/rooms/${best.roomCode}`);
      } catch (error) {
        setJoinMessage(error instanceof Error ? error.message : "Something went wrong");
      }
    });
  }

  function joinRoomWithCode() {
    setMessage(null);
    setJoinMessage(null);
    startTransition(async () => {
      try {
        validateNickname();
        if (!roomCodeHasValidFormat) {
          throw new Error("Enter a valid 6-character room code");
        }
        const open = await fetchOpenRooms();
        const matchingRoom = open.find((room) => room.roomCode === normalizedRoomCode && room.playerCount < room.maxPlayers);
        if (!matchingRoom) {
          throw new Error("That room code is not open right now");
        }
        navigate(`/rooms/${matchingRoom.roomCode}`);
      } catch (error) {
        setJoinMessage(error instanceof Error ? error.message : "Something went wrong");
      }
    });
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col justify-center px-4 py-8 sm:px-6">
      <section className="py-8 sm:py-12">
        <h1 className="text-4xl font-semibold leading-tight text-slate-950 sm:text-6xl">NFL Path Guesser</h1>
        <p className="mt-3 text-lg text-slate-600 sm:text-2xl">Guess the player from the career path</p>

        <button
          type="button"
          onClick={() => navigate("/solo")}
          className="mt-8 rounded-full bg-slate-950 px-6 py-3 text-base font-semibold text-white transition hover:bg-slate-800"
        >
          Quick Solo Play
        </button>

        <div className="mt-12 max-w-md">
          <h2 className="text-2xl font-semibold text-slate-950 sm:text-3xl">Compete with friends!</h2>
          <label className="mt-5 block text-sm font-medium text-slate-700">
            Nickname
            <input
              value={nickname}
              onChange={(event) => setNicknameState(event.target.value)}
              placeholder="Gridiron Guru"
              className="mt-2 w-full rounded-[1rem] border border-slate-200 bg-white/80 px-4 py-3 text-base text-slate-950 outline-none transition focus:border-sky-300"
            />
          </label>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              disabled={pending}
              onClick={createRoom}
              className="rounded-full border border-slate-200 bg-white/80 px-4 py-3 font-semibold text-slate-900 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-70"
            >
              Create Room
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                setMessage(null);
                setJoinMessage(null);
                setJoinMode("choices");
                setJoinDialogOpen(true);
              }}
              className="rounded-full border border-slate-200 bg-white/80 px-4 py-3 font-semibold text-slate-900 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-70"
            >
              Join a Room
            </button>
          </div>

          {message ? (
            <div className="mt-4 rounded-[1rem] border border-sky-200 bg-white/80 px-4 py-3 text-sm text-slate-900">
              {message}
            </div>
          ) : null}

          {showLocalTools ? (
            <Link
              to="/catalog"
              className="mt-4 inline-flex rounded-full border border-dashed border-slate-300 bg-white/60 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-white"
            >
              Local Player Inspector
            </Link>
          ) : null}
        </div>
      </section>

      {joinDialogOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 px-4">
          <div className="w-full max-w-md rounded-[1.5rem] bg-white p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-sky-700">Join a Room</p>
                <h2 className="mt-1 text-2xl font-semibold text-slate-950">
                  {joinMode === "choices" ? "How do you want to join?" : "Enter room code"}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setJoinDialogOpen(false)}
                className="rounded-full border border-slate-200 px-3 py-1.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-50"
              >
                Close
              </button>
            </div>

            {joinMode === "choices" ? (
              <div className="mt-5 grid gap-3">
                <button
                  type="button"
                  disabled={pending}
                  onClick={findRoom}
                  className="rounded-[1rem] bg-slate-950 px-4 py-3 font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-70"
                >
                  Find Me a Room
                </button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => {
                    setJoinMessage(null);
                    setJoinMode("code");
                  }}
                  className="rounded-[1rem] border border-slate-200 px-4 py-3 font-semibold text-slate-900 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-70"
                >
                  Join With a Room Code
                </button>
              </div>
            ) : (
              <div className="mt-5">
                <label className="block text-sm font-medium text-slate-700">
                  Room code
                  <input
                    value={roomCode}
                    onChange={(event) => {
                      setJoinMessage(null);
                      setRoomCode(normalizeRoomCode(event.target.value));
                    }}
                    placeholder="ABC123"
                    className="mt-2 w-full rounded-[1rem] border border-slate-200 px-4 py-3 text-base font-semibold tracking-[0.12em] text-slate-950 outline-none transition focus:border-sky-300"
                  />
                </label>
                {!roomCodeHasValidFormat && roomCode ? (
                  <p className="mt-2 text-sm text-slate-500">Room codes are 6 letters or numbers.</p>
                ) : null}
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => {
                      setJoinMessage(null);
                      setJoinMode("choices");
                    }}
                    className="rounded-full border border-slate-200 px-4 py-3 font-semibold text-slate-700 transition hover:bg-slate-50"
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    disabled={pending || !roomCodeHasValidFormat}
                    onClick={joinRoomWithCode}
                    className="rounded-full bg-slate-950 px-4 py-3 font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    Continue
                  </button>
                </div>
              </div>
            )}
            {joinMessage ? (
              <div className="mt-4 rounded-[1rem] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
                {joinMessage}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </main>
  );
}
