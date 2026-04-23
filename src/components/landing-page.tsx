"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

type JoinResponse = {
  roomCode: string;
  participantId: string;
  participantToken: string;
};

function roomTokenKey(roomCode: string) {
  return `guess-the-player-production-09c4.up:token:${roomCode}`;
}

function roomParticipantKey(roomCode: string) {
  return `guess-the-player-production-09c4.up:participant:${roomCode}`;
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
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col justify-center px-4 py-4 sm:px-6 sm:py-6">
      <section className="glass-panel rounded-[1.5rem] border border-sky-100 bg-white p-6 sm:p-8 lg:p-10">
        <div className="grid gap-8 lg:grid-cols-[1.05fr_0.95fr] lg:items-center">
          <div className="max-w-3xl">
            <h1 className="text-4xl font-semibold leading-tight text-slate-950 sm:text-5xl lg:text-6xl">
              Guess the player from the career path before your friends do.
            </h1>
            <p className="mt-4 max-w-2xl text-base text-slate-600 sm:text-lg">Create a room, pull in friends.</p>
          </div>

          <div className="rounded-[1.5rem] border border-sky-100 bg-sky-50/70 p-6 sm:p-7">
            <p className="text-sm uppercase tracking-[0.24em] text-slate-500">Start playing</p>
            <label className="mt-5 block text-sm text-slate-700">
              Nickname
              <input
                value={nickname}
                onChange={(event) => setNickname(event.target.value)}
                placeholder="Gridiron Guru"
                className="mt-2 w-full rounded-[1rem] border border-sky-100 bg-white px-4 py-3 text-base text-slate-950 outline-none transition focus:border-sky-300"
              />
            </label>
            <div className="mt-5 grid gap-3">
              <button
                type="button"
                disabled={pending}
                onClick={() => handleAction("create")}
                className="rounded-[1rem] bg-slate-950 px-4 py-3 font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-70"
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
