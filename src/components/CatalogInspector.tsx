import { useMemo, useState } from "react";
import { Link, Navigate } from "react-router-dom";

import { CATALOG, findPlayersByName } from "@/lib/catalog";
import { TeamPath } from "@/components/TeamPath";

function isLocalhost() {
  if (typeof window === "undefined") return false;
  return ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
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
      <div className="scoreboard px-4 py-3 sm:px-5 sm:py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="font-pixel text-helmet text-[0.5rem] sm:text-[0.625rem]">⚙ Localhost only</p>
            <h1 className="font-pixel text-helmet mt-2 text-xs sm:text-lg">Player Catalog Inspector</h1>
          </div>
          <Link to="/" className="pixel-button pixel-button-ghost min-h-0 px-3 py-2 text-[0.55rem]">
            ↩ Home
          </Link>
        </div>
      </div>

      <section className="grid gap-4 lg:grid-cols-[0.85fr_1.15fr]">
        <div className="pixel-panel p-4 sm:p-5">
          <label className="font-pixel text-helmet block text-[0.5rem] sm:text-[0.625rem]">
            Player name
            <input
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setSelectedId(null);
              }}
              placeholder="TOM BRADY"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
              className="pixel-input mt-2"
            />
          </label>
          <p className="font-readable text-chalk-dim mt-3 text-base">{CATALOG.length} players in catalog</p>

          <div className="mt-4 grid gap-2">
            {results.map((player) => (
              <button
                key={player.id}
                type="button"
                onClick={() => setSelectedId(player.id)}
                className="border-4 border-yardline bg-endzone p-3 text-left hover:border-helmet"
              >
                <span className="font-readable text-chalk block text-base sm:text-lg">{player.fullName}</span>
                <span className="font-pixel text-helmet mt-2 block text-[0.5rem] sm:text-[0.55rem]">
                  {player.position} · {player.difficulty} · {player.careerStatus.replace("_", " ")}
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="pixel-panel-accent p-4 sm:p-6">
          {selected ? (
            <>
              <div className="flex flex-wrap items-start gap-4">
                <img
                  src={selected.headshotUrl}
                  alt={selected.fullName}
                  width={120}
                  height={120}
                  className="h-24 w-24 border-4 border-helmet bg-endzone object-cover sm:h-32 sm:w-32"
                />
                <div className="min-w-0">
                  <p className="font-pixel text-helmet text-[0.55rem] sm:text-xs">▼ Selected player</p>
                  <h2 className="font-pixel text-chalk mt-2 text-base sm:text-2xl">{selected.fullName}</h2>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <span className="pixel-tag pixel-tag-yellow">{selected.position}</span>
                    <span className="pixel-tag pixel-tag-blue capitalize">{selected.difficulty}</span>
                    <span className="pixel-tag capitalize">{selected.careerStatus.replace("_", " ")}</span>
                    <span className="pixel-tag">{selected.uniqueTeamCount} teams</span>
                  </div>
                </div>
              </div>

              <div className="mt-6">
                <TeamPath teamStints={selected.teamStints} showYears />
              </div>
            </>
          ) : (
            <div className="border-4 border-yardline bg-endzone px-4 py-8 text-center">
              <p className="font-readable text-chalk-dim text-base">Search for a player to inspect their generated data.</p>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
