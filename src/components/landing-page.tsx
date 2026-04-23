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

export function LandingPage() {
  const router = useRouter();
  const [nickname, setNickname] = useState("");
  const [message, setMessage] = useState<string | null>(null);
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
    <main className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-8 px-5 py-8 sm:px-8 lg:px-10">
      <section className="relative overflow-hidden rounded-[2rem] border border-white/10 bg-[radial-gradient(circle_at_top_left,_rgba(255,122,24,0.35),_transparent_28%),linear-gradient(135deg,rgba(255,255,255,0.08),rgba(255,255,255,0.02))] p-8 shadow-[0_28px_80px_rgba(0,0,0,0.35)] sm:p-12">
        <div className="absolute inset-y-0 right-0 w-1/2 bg-[radial-gradient(circle_at_center,_rgba(255,209,102,0.16),_transparent_58%)]" />
        <div className="relative grid gap-10 lg:grid-cols-[1.2fr_0.8fr] lg:items-end">
          <div className="max-w-3xl">
            <p className="mb-3 inline-flex rounded-full border border-white/15 bg-white/6 px-3 py-1 text-xs uppercase tracking-[0.3em] text-white/75">
              Live PvP NFL Trivia
            </p>
            <h1 className="display-font text-5xl font-semibold leading-[0.92] text-white sm:text-6xl lg:text-7xl">
              Guess the player from the career path before anyone else does.
            </h1>
            <p className="mt-5 max-w-2xl text-base text-slate-200/80 sm:text-lg">
              Create a room, pull in friends, and race through hidden NFL players using only the ordered team timeline.
            </p>
            <div className="mt-8 grid gap-4 sm:grid-cols-3">
              {[
                "Live room invites",
                "Kahoot-style scoring",
                "Difficulty filters + no-timer mode"
              ].map((item) => (
                <div key={item} className="rounded-3xl border border-white/12 bg-slate-950/35 px-4 py-4 text-sm text-slate-100/85">
                  {item}
                </div>
              ))}
            </div>
          </div>

          <div className="glass-panel rounded-[1.75rem] p-6 sm:p-7">
            <p className="text-sm uppercase tracking-[0.28em] text-slate-300/70">Start playing</p>
            <label className="mt-5 block text-sm text-slate-200/85">
              Nickname
              <input
                value={nickname}
                onChange={(event) => setNickname(event.target.value)}
                placeholder="Gridiron Guru"
                className="mt-2 w-full rounded-2xl border border-white/10 bg-slate-950/55 px-4 py-3 text-base outline-none transition focus:border-orange-300/55"
              />
            </label>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                disabled={pending}
                onClick={() => handleAction("create")}
                className="rounded-2xl bg-[linear-gradient(135deg,#ff7a18,#ff9b47)] px-4 py-3 font-medium text-slate-950 transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-70"
              >
                Create Room
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => handleAction("join")}
                className="rounded-2xl border border-white/14 bg-white/6 px-4 py-3 font-medium text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-70"
              >
                Join Fullest Room
              </button>
            </div>
            <p className="mt-4 text-sm text-slate-300/70">
              Join fills the fullest open public lobby. If no room exists, you can create one in a click.
            </p>
            {message ? (
              <div className="mt-4 rounded-2xl border border-red-300/20 bg-red-500/10 px-4 py-3 text-sm text-red-100">
                {message}
              </div>
            ) : null}
          </div>
        </div>
      </section>
    </main>
  );
}
