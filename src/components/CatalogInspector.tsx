import { useMemo, useState } from "react";
import { Link, Navigate } from "react-router-dom";

import { CATALOG, findPlayersByName } from "@/lib/catalog";
import { NFL_TEAMS, formatTeamLabel } from "@/lib/nfl-teams";
import type { PlayerCatalogEntry } from "@/lib/types";
import { formatYearRange } from "@/lib/utils";

function isLocalhost() {
  if (typeof window === "undefined") return false;
  return ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
}

function isCurrent(player: PlayerCatalogEntry) {
  return player.teamStints.some((stint) => stint.endYear === null);
}

export function CatalogInspector() {
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const results = useMemo(() => findPlayersByName(query, 16), [query]);
  const selected = useMemo(
    () => CATALOG.find((player) => player.id === selectedId) ?? results[0] ?? null,
    [results, selectedId]
  );

  if (!isLocalhost()) {
    return <Navigate to="/" replace />;
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-4 px-4 py-4 sm:px-6 sm:py-6">
      <div className="glass-panel rounded-[1.5rem] px-4 py-3 sm:px-5 sm:py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-[0.24em] text-sky-700 sm:text-xs">Localhost only</p>
            <h1 className="mt-1 text-xl font-semibold text-slate-950 sm:text-3xl">Player Catalog Inspector</h1>
          </div>
          <Link
            to="/"
            className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            Back Home
          </Link>
        </div>
      </div>

      <section className="grid gap-4 lg:grid-cols-[0.85fr_1.15fr]">
        <div className="glass-panel rounded-[1.5rem] p-4 sm:p-5">
          <label className="block text-sm font-semibold text-slate-700">
            Player name
            <input
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setSelectedId(null);
              }}
              placeholder="Tom Brady"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
              className="mt-2 w-full rounded-[1rem] border border-slate-200 bg-white px-4 py-3 text-slate-950 outline-none transition focus:border-sky-300"
            />
          </label>
          <p className="mt-3 text-sm text-slate-500">{CATALOG.length} players in the generated catalog</p>

          <div className="mt-4 grid gap-2">
            {results.map((player) => (
              <button
                key={player.id}
                type="button"
                onClick={() => setSelectedId(player.id)}
                className="rounded-[1rem] border border-slate-200 bg-white px-4 py-3 text-left transition hover:bg-slate-50"
              >
                <span className="block font-semibold text-slate-950">{player.fullName}</span>
                <span className="mt-1 block text-xs uppercase tracking-[0.16em] text-slate-500">
                  {player.position} · {player.difficulty} · {isCurrent(player) ? "Current" : "Inactive"}
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="glass-panel rounded-[1.5rem] p-4 sm:p-6">
          {selected ? (
            <>
              <div className="flex flex-wrap items-start gap-4">
                <img
                  src={selected.headshotUrl}
                  alt={selected.fullName}
                  width={120}
                  height={120}
                  className="h-24 w-24 rounded-[1.2rem] border border-slate-200 bg-slate-50 object-cover sm:h-32 sm:w-32"
                />
                <div>
                  <p className="text-xs uppercase tracking-[0.2em] text-sky-700">Selected player</p>
                  <h2 className="mt-1 text-2xl font-semibold text-slate-950 sm:text-4xl">{selected.fullName}</h2>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <span className="rounded-full border border-sky-100 bg-sky-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-sky-800">
                      {selected.position}
                    </span>
                    <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold capitalize tracking-[0.08em] text-slate-700">
                      {selected.difficulty}
                    </span>
                    <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700">
                      {selected.uniqueTeamCount} teams
                    </span>
                  </div>
                </div>
              </div>

              <div className="mt-6 grid gap-3 sm:grid-cols-2">
                {selected.teamStints.map((stint, index) => {
                  const team = NFL_TEAMS[stint.teamId];
                  return (
                    <article
                      key={`${stint.teamId}-${index}-${stint.startYear}`}
                      className="rounded-[1.1rem] border border-slate-200 bg-white p-3"
                    >
                      <div className="flex items-center gap-3">
                        <img src={team.logoUrl} alt="" width={44} height={44} className="h-11 w-11 object-contain" />
                        <div>
                          <p className="text-[10px] uppercase tracking-[0.2em] text-slate-400">Stop {index + 1}</p>
                          <h3 className="font-semibold text-slate-950">{formatTeamLabel(stint.teamId)}</h3>
                        </div>
                      </div>
                      <p className="mt-2 text-sm font-medium text-slate-700">{formatYearRange(stint.startYear, stint.endYear)}</p>
                      <div className="mt-3 h-1.5 rounded-full" style={{ backgroundColor: team.primary }} />
                    </article>
                  );
                })}
              </div>
            </>
          ) : (
            <div className="rounded-[1.2rem] border border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-600">
              Search for a player to inspect their generated data.
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
