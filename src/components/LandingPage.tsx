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
      <section className="py-6 sm:py-10">
        <h1
          className="font-pixel text-helmet uppercase leading-tight"
          style={{
            fontSize: "var(--fs-hero)",
            textShadow: "4px 4px 0 #0a2a14, 8px 8px 0 #0f3d1d"
          }}
        >
          NFL Path Guesser
        </h1>
        <p
          className="font-readable text-helmet mt-4"
          style={{
            fontSize: "var(--fs-body)",
            textShadow:
              "-2px 0 0 #0a2a14, 2px 0 0 #0a2a14, 0 -2px 0 #0a2a14, 0 2px 0 #0a2a14, -2px -2px 0 #0a2a14, 2px -2px 0 #0a2a14, -2px 2px 0 #0a2a14, 2px 2px 0 #0a2a14"
          }}
        >
          Guess the player from the career path
        </p>
        <p className="font-pixel text-helmet blink mt-3 text-[0.55rem] sm:text-xs">
          ▶ Test your ball knowledge!
        </p>

        <div className="mt-8 grid gap-3 sm:inline-grid sm:grid-cols-2">
          <button
            type="button"
            onClick={() => navigate("/daily")}
            className="pixel-button pixel-button-accent w-full"
          >
            Daily Challenge
          </button>
          <button
            type="button"
            onClick={() => navigate("/solo")}
            className="pixel-button pixel-button-primary w-full"
          >
            ▶ Quick Solo Play
          </button>
        </div>

        <div className="pixel-panel mt-10 max-w-md p-4 sm:p-5">
          <p className="font-pixel text-helmet text-[0.55rem] sm:text-xs">▼ Compete with friends</p>
          <label className="font-pixel text-chalk mt-4 block text-[0.5rem] sm:text-[0.65rem]">
            Nickname
            <input
              value={nickname}
              onChange={(event) => setNicknameState(event.target.value)}
              placeholder="GRIDIRON GURU"
              className="pixel-input mt-2"
            />
          </label>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              disabled={pending}
              onClick={createRoom}
              className="pixel-button pixel-button-primary"
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
              className="pixel-button pixel-button-secondary"
            >
              Join a Room
            </button>
          </div>

          {message ? (
            <div className="pixel-panel-flat mt-4 border-jersey-red p-3">
              <p className="font-readable text-chalk text-base">{message}</p>
            </div>
          ) : null}

          {showLocalTools ? (
            <Link
              to="/catalog"
              className="pixel-button pixel-button-ghost mt-4 inline-flex text-[0.5rem] sm:text-[0.625rem]"
            >
              ⚙ Local Player Inspector
            </Link>
          ) : null}
        </div>
      </section>

      {joinDialogOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-endzone/80 px-4">
          <div className="pixel-panel-accent w-full max-w-md p-4 sm:p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-pixel text-helmet text-[0.55rem] sm:text-xs">▼ Join a Room</p>
                <h2 className="font-pixel text-chalk mt-2 text-sm sm:text-lg">
                  {joinMode === "choices" ? "How do you want to join?" : "Enter room code"}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setJoinDialogOpen(false)}
                className="pixel-button pixel-button-ghost shrink-0 px-3 py-2 text-[0.55rem]"
              >
                ✕
              </button>
            </div>

            {joinMode === "choices" ? (
              <div className="mt-5 grid gap-3">
                <button
                  type="button"
                  disabled={pending}
                  onClick={findRoom}
                  className="pixel-button pixel-button-primary"
                >
                  ▶ Find Me a Room
                </button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => {
                    setJoinMessage(null);
                    setJoinMode("code");
                  }}
                  className="pixel-button pixel-button-secondary"
                >
                  ▶ Join With a Room Code
                </button>
              </div>
            ) : (
              <div className="mt-5">
                <label className="font-pixel text-chalk block text-[0.55rem] sm:text-[0.65rem]">
                  Room code
                  <input
                    value={roomCode}
                    onChange={(event) => {
                      setJoinMessage(null);
                      setRoomCode(normalizeRoomCode(event.target.value));
                    }}
                    placeholder="ABC123"
                    className="pixel-input mt-2 text-center font-pixel text-base tracking-[0.3em] uppercase"
                  />
                </label>
                {!roomCodeHasValidFormat && roomCode ? (
                  <p className="font-readable text-chalk-dim mt-2 text-base">Room codes are 6 letters or numbers.</p>
                ) : null}
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => {
                      setJoinMessage(null);
                      setJoinMode("choices");
                    }}
                    className="pixel-button pixel-button-ghost"
                  >
                    ◀ Back
                  </button>
                  <button
                    type="button"
                    disabled={pending || !roomCodeHasValidFormat}
                    onClick={joinRoomWithCode}
                    className="pixel-button pixel-button-primary"
                  >
                    Continue ▶
                  </button>
                </div>
              </div>
            )}
            {joinMessage ? (
              <div className="pixel-panel-flat mt-4 border-jersey-red p-3">
                <p className="font-readable text-chalk text-base">{joinMessage}</p>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </main>
  );
}
