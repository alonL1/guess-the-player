"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

type JoinResponse = {
  roomCode: string;
  participantId: string;
  participantToken: string;
};

function roomTokenKey(roomCode: string) {
  return `guess-the-player:token:${roomCode}`;
}

function roomParticipantKey(roomCode: string) {
  return `guess-the-player:participant:${roomCode}`;
}

async function createGuestSession(nickname: string) {
  const response = await fetch("/api/session/guest", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ nickname })
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? "Unable to create a guest session.");
  }
}

async function createRoom() {
  const response = await fetch("/api/rooms", {
    method: "POST"
  });

  const body = (await response.json().catch(() => null)) as JoinResponse & { error?: string };
  if (!response.ok) {
    throw new Error(body.error ?? "Unable to create room.");
  }

  return body;
}

async function joinBestRoom() {
  const response = await fetch("/api/rooms/join-best", {
    method: "POST"
  });

  const body = (await response.json().catch(() => null)) as JoinResponse & { error?: string };
  if (!response.ok) {
    throw new Error(body.error ?? "Unable to join a room.");
  }

  return body;
}

export function LandingPage({ initialMessage = null }: { initialMessage?: string | null }) {
  const router = useRouter();
  const [nickname, setNickname] = useState("");
  const [message, setMessage] = useState<string | null>(initialMessage);
  const [pending, startTransition] = useTransition();

  function persistRoomAuth(data: JoinResponse) {
    localStorage.setItem(roomTokenKey(data.roomCode), data.participantToken);
    localStorage.setItem(roomParticipantKey(data.roomCode), data.participantId);
  }

  function handleAction(action: "create" | "join") {
    setMessage(null);
    startTransition(async () => {
      try {
        const trimmed = nickname.trim();
        if (trimmed.length < 2) {
          throw new Error("Pick a nickname with at least 2 characters.");
        }

        localStorage.setItem("guess-the-player:nickname", trimmed);
        await createGuestSession(trimmed);

        const room = action === "create" ? await createRoom() : await joinBestRoom();
        persistRoomAuth(room);
        router.push(`/rooms/${room.roomCode}`);
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Something went wrong.");
      }
    });
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-6 px-4 py-4 sm:px-6 sm:py-6">
      <section className="relative overflow-hidden rounded-[2rem] border border-amber-100 bg-[radial-gradient(circle_at_top_left,_rgba(251,191,36,0.22),_transparent_26%),linear-gradient(145deg,rgba(255,255,255,0.96),rgba(255,250,240,0.94))] p-6 shadow-[0_28px_80px_rgba(120,113,108,0.14)] sm:p-8 lg:p-12">
        <div className="absolute inset-y-0 right-0 w-1/2 bg-[radial-gradient(circle_at_center,_rgba(251,191,36,0.16),_transparent_58%)]" />
        <div className="relative grid gap-8 lg:grid-cols-[1.05fr_0.95fr] lg:items-end">
          <div className="max-w-3xl">
            <p className="mb-3 inline-flex rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs uppercase tracking-[0.3em] text-amber-700">
              Live PvP NFL Trivia
            </p>
            <h1 className="display-font text-4xl font-semibold leading-[0.95] text-stone-950 sm:text-5xl lg:text-6xl">
              Guess the player from the career path before anyone else does.
            </h1>
            <p className="mt-5 max-w-2xl text-base text-stone-600 sm:text-lg">
              Create a room, pull in friends, and race through hidden NFL players using only the ordered team timeline.
            </p>
            <div className="mt-8 grid gap-3 sm:grid-cols-3">
              {[
                "Live room invites",
                "Kahoot-style scoring",
                "Difficulty filters + no-timer mode"
              ].map((item) => (
                <div key={item} className="rounded-[1.4rem] border border-stone-200 bg-white px-4 py-4 text-sm text-stone-700 shadow-[0_12px_28px_rgba(120,113,108,0.08)]">
                  {item}
                </div>
              ))}
            </div>
          </div>

          <div className="glass-panel rounded-[1.75rem] p-6 sm:p-7">
            <p className="text-sm uppercase tracking-[0.28em] text-stone-500">Start playing</p>
            <label className="mt-5 block text-sm text-stone-700">
              Nickname
              <input
                value={nickname}
                onChange={(event) => setNickname(event.target.value)}
                placeholder="Gridiron Guru"
                className="mt-2 w-full rounded-[1.2rem] border border-stone-200 bg-white px-4 py-3 text-base text-stone-950 outline-none transition focus:border-amber-400"
              />
            </label>
            <div className="mt-5 grid gap-3">
              <button
                type="button"
                disabled={pending}
                onClick={() => handleAction("create")}
                className="rounded-[1.2rem] bg-stone-950 px-4 py-3 font-semibold text-white transition hover:bg-stone-800 disabled:cursor-not-allowed disabled:opacity-70"
              >
                Create Room
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => handleAction("join")}
                className="rounded-[1.2rem] border border-stone-200 bg-white px-4 py-3 font-semibold text-stone-800 transition hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-70"
              >
                Join Fullest Room
              </button>
            </div>
            <p className="mt-4 text-sm text-stone-500">
              Join fills the fullest open public lobby. If no room exists, you can create one in a click.
            </p>
            {message ? (
              <div className="mt-4 rounded-[1.2rem] border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                {message}
              </div>
            ) : null}
          </div>
        </div>
      </section>
    </main>
  );
}
