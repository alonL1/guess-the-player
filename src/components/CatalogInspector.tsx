import clsx from "clsx";
import { useEffect, useMemo, useState } from "react";
import { Link, Navigate } from "react-router-dom";

import { CATALOG, isCurrentPlayer } from "@/lib/catalog";
import { TeamPath } from "@/components/TeamPath";
import { formatPositionGroup, isPositionInGroup, POSITION_GROUP_OPTIONS } from "@/lib/positions";
import type { Difficulty, PositionGroup } from "@/lib/types";
import { normalizeSearchText } from "@/lib/utils";
import type { PlayerDebug } from "@/lib/generated-player-debug";

type ThresholdGroup = { easy: number; medium: number; hard: number; impossible: number };
type Thresholds = { offense: ThresholdGroup; defense: ThresholdGroup; specialTeams: ThresholdGroup };
type DifficultyFilter = "all" | Difficulty;
type SortOrder = "fam_desc" | "fam_asc" | "name" | "position";

const RESULT_LIMIT = 120;

function isLocalhost() {
  if (typeof window === "undefined") return false;
  return ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
}

function StatRow({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-yardline/30 py-1">
      <span className="font-pixel text-helmet text-[0.5rem] sm:text-[0.55rem]">{label}</span>
      <span className="font-readable text-chalk text-base sm:text-lg">{value}</span>
    </div>
  );
}

function getThresholdGroup(position: string, thresholds: Thresholds | null) {
  if (!thresholds) return null;
  if (isPositionInGroup(position, "offense")) return { label: "Offense", values: thresholds.offense };
  if (isPositionInGroup(position, "defense")) return { label: "Defense", values: thresholds.defense };
  return { label: "Special teams", values: thresholds.specialTeams };
}

function DifficultyBreakdown({
  difficulty,
  position,
  debug,
  thresholds
}: {
  difficulty: string;
  position: string;
  debug: PlayerDebug;
  thresholds: Thresholds | null;
}) {
  const thresholdGroup = getThresholdGroup(position, thresholds);

  return (
    <div className="mt-6 border-4 border-yardline bg-endzone p-3 sm:p-4">
      <p className="font-pixel text-helmet text-[0.55rem] sm:text-xs">▼ How this difficulty was reached</p>

      {/* Final score → bucket */}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-4 border-helmet bg-turf-shadow px-3 py-2">
        <span className="font-pixel text-chalk text-[0.55rem] sm:text-xs">FAMILIARITY</span>
        <span className="font-pixel text-helmet text-lg sm:text-2xl">{debug.familiarity}</span>
        <span className="pixel-tag pixel-tag-yellow capitalize">{difficulty}</span>
      </div>
      <p className="font-pixel text-chalk-dim mt-2 text-[0.45rem] leading-relaxed sm:text-[0.55rem]">
        Difficulty uses fixed familiarity thresholds by side of the ball, so random draws stay random while defense must
        clear stricter cut lines.{" "}
        {thresholdGroup
          ? `${thresholdGroup.label}: easy >= ${thresholdGroup.values.easy} · medium >= ${thresholdGroup.values.medium} · hard >= ${thresholdGroup.values.hard} · impossible >= ${thresholdGroup.values.impossible}.`
          : ""}
      </p>

      {/* The equation */}
      <p className="font-pixel text-helmet mt-4 text-[0.5rem] sm:text-[0.55rem]">Score equation</p>
      <div className="mt-2">
        <StatRow label={`quality (posFactor ${debug.positionFactor} × core ${debug.core})`} value={debug.quality} />
        <StatRow
          label={`+ context (longevity ${debug.longevity} + teams ${debug.teamBonus} + recency ${debug.recency}, × gate ${debug.productionGate})`}
          value={debug.context}
        />
        {debug.recentDefensiveImpact > 0 ? (
          <StatRow label="+ recent defensive impact" value={`+${debug.recentDefensiveImpact}`} />
        ) : null}
        {debug.defenseDiscount > 0 ? (
          <StatRow label="− defensive familiarity discount" value={`-${debug.defenseDiscount}`} />
        ) : null}
        <div className="mt-1 flex items-baseline justify-between gap-3 py-1">
          <span className="font-pixel text-good text-[0.5rem] sm:text-[0.55rem]">= familiarity</span>
          <span className="font-pixel text-good text-base sm:text-lg">{debug.familiarity}</span>
        </div>
      </div>

      {/* Core production */}
      <p className="font-pixel text-helmet mt-4 text-[0.5rem] sm:text-[0.55rem]">Core production (peak·0.7 + avg·1.15)</p>
      <div className="mt-2">
        <StatRow label="peak (best single season)" value={debug.peak} />
        <StatRow label="career total prominence" value={debug.careerProminence} />
        <StatRow label="avg per season" value={debug.avg} />
        {debug.preStatSeasons > 0 ? (
          <StatRow label={`pre-1999 bonus (${debug.preStatSeasons} seasons × 6)`} value={`+${debug.preStatBonus}`} />
        ) : null}
        {debug.longevityFallback > 0 ? (
          <StatRow label="longevity fallback (no stats)" value={debug.longevityFallback} />
        ) : null}
        <StatRow label="core" value={debug.core} />
      </div>

      {/* Raw inputs */}
      <p className="font-pixel text-helmet mt-4 text-[0.5rem] sm:text-[0.55rem]">Inputs</p>
      <div className="mt-2">
        <StatRow label="seasons played" value={debug.seasonCount} />
        <StatRow label="unique franchises" value={debug.uniqueTeamCount} />
        <StatRow label="career span" value={`${debug.careerStartYear} – ${debug.lastSeason}`} />
        <StatRow label="years since last season" value={debug.yearsAgo} />
        <StatRow label="position factor" value={debug.positionFactor} />
      </div>
    </div>
  );
}

export function CatalogInspector() {
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [debugMap, setDebugMap] = useState<Record<string, PlayerDebug> | null>(null);
  const [thresholds, setThresholds] = useState<Thresholds | null>(null);
  const [difficultyFilter, setDifficultyFilter] = useState<DifficultyFilter>("all");
  const [positionGroupFilter, setPositionGroupFilter] = useState<PositionGroup>("all");
  const [currentOnly, setCurrentOnly] = useState(false);
  const [minFam, setMinFam] = useState("");
  const [maxFam, setMaxFam] = useState("");
  const [sortOrder, setSortOrder] = useState<SortOrder>("fam_desc");

  const filtered = useMemo(() => {
    const q = normalizeSearchText(query);
    const lo = minFam.trim() === "" ? -Infinity : Number(minFam);
    const hi = maxFam.trim() === "" ? Infinity : Number(maxFam);
    const fam = (id: string) => debugMap?.[id]?.familiarity ?? 0;

    const list = CATALOG.filter((player) => {
      if (currentOnly && !isCurrentPlayer(player)) return false;
      if (difficultyFilter !== "all" && player.difficulty !== difficultyFilter) return false;
      if (!isPositionInGroup(player.position, positionGroupFilter)) return false;
      if (q && !player.normalizedName.includes(q)) return false;
      if (debugMap) {
        const f = fam(player.id);
        if (f < lo || f > hi) return false;
      }
      return true;
    });

    list.sort((a, b) => {
      if (sortOrder === "name") return a.fullName.localeCompare(b.fullName);
      if (sortOrder === "position") return a.position.localeCompare(b.position) || fam(b.id) - fam(a.id);
      const diff = sortOrder === "fam_asc" ? fam(a.id) - fam(b.id) : fam(b.id) - fam(a.id);
      return diff || a.fullName.localeCompare(b.fullName);
    });
    return list;
  }, [query, currentOnly, difficultyFilter, positionGroupFilter, minFam, maxFam, sortOrder, debugMap]);

  const results = useMemo(() => filtered.slice(0, RESULT_LIMIT), [filtered]);
  const selected = useMemo(
    () => CATALOG.find((player) => player.id === selectedId) ?? results[0] ?? null,
    [results, selectedId]
  );

  // Lazy-load the difficulty debug data (separate chunk, localhost only — never
  // ships in the main game bundle).
  useEffect(() => {
    if (!isLocalhost()) return;
    let cancelled = false;
    void import("@/lib/generated-player-debug").then((mod) => {
      if (cancelled) return;
      setDebugMap(mod.PLAYER_DEBUG);
      setThresholds(mod.FAMILIARITY_THRESHOLDS);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!isLocalhost()) {
    return <Navigate to="/" replace />;
  }

  const selectedDebug = selected && debugMap ? debugMap[selected.id] ?? null : null;

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

          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <label className="font-pixel text-helmet block text-[0.5rem] sm:text-[0.625rem]">
              Difficulty
              <select
                value={difficultyFilter}
                onChange={(event) => {
                  setDifficultyFilter(event.target.value as DifficultyFilter);
                  setSelectedId(null);
                }}
                className="pixel-select mt-2"
              >
                <option value="all">All</option>
                <option value="easy">Easy</option>
                <option value="medium">Medium</option>
                <option value="hard">Hard</option>
                <option value="impossible">Impossible</option>
              </select>
            </label>
            <label className="font-pixel text-helmet block text-[0.5rem] sm:text-[0.625rem]">
              Side
              <select
                value={positionGroupFilter}
                onChange={(event) => {
                  setPositionGroupFilter(event.target.value as PositionGroup);
                  setSelectedId(null);
                }}
                className="pixel-select mt-2"
              >
                {POSITION_GROUP_OPTIONS.map((positionGroup) => (
                  <option key={positionGroup} value={positionGroup}>
                    {formatPositionGroup(positionGroup)}
                  </option>
                ))}
              </select>
            </label>
            <label className="font-pixel text-helmet block text-[0.5rem] sm:text-[0.625rem]">
              Sort by
              <select
                value={sortOrder}
                onChange={(event) => {
                  setSortOrder(event.target.value as SortOrder);
                  setSelectedId(null);
                }}
                className="pixel-select mt-2"
              >
                <option value="fam_desc">Familiarity high → low</option>
                <option value="fam_asc">Familiarity low → high</option>
                <option value="name">Name A → Z</option>
                <option value="position">Position</option>
              </select>
            </label>
          </div>

          <button
            type="button"
            onClick={() => {
              setCurrentOnly((value) => !value);
              setSelectedId(null);
            }}
            className={clsx(
              "pixel-button mt-3 w-full justify-center text-[0.6rem] sm:text-[0.7rem]",
              currentOnly ? "pixel-button-primary" : "pixel-button-ghost"
            )}
            aria-pressed={currentOnly}
          >
            Current Only: {currentOnly ? "ON" : "OFF"}
          </button>

          <div className="mt-3 grid grid-cols-2 gap-3">
            <label className="font-pixel text-helmet block text-[0.5rem] sm:text-[0.625rem]">
              Familiarity min
              <input
                type="number"
                inputMode="numeric"
                value={minFam}
                onChange={(event) => {
                  setMinFam(event.target.value);
                  setSelectedId(null);
                }}
                placeholder="0"
                className="pixel-input mt-2"
              />
            </label>
            <label className="font-pixel text-helmet block text-[0.5rem] sm:text-[0.625rem]">
              Familiarity max
              <input
                type="number"
                inputMode="numeric"
                value={maxFam}
                onChange={(event) => {
                  setMaxFam(event.target.value);
                  setSelectedId(null);
                }}
                placeholder="∞"
                className="pixel-input mt-2"
              />
            </label>
          </div>

          <p className="font-readable text-chalk-dim mt-3 text-base">
            {filtered.length} match{filtered.length === 1 ? "" : "es"}
            {filtered.length > RESULT_LIMIT ? ` · showing first ${RESULT_LIMIT}` : ""} · {CATALOG.length} total
          </p>
          {!debugMap ? (
            <p className="font-pixel text-helmet mt-1 text-[0.45rem] blink sm:text-[0.5rem]">Loading scores…</p>
          ) : null}

          <div className="mt-4 grid gap-2">
            {results.map((player) => {
              const fam = debugMap?.[player.id]?.familiarity;
              return (
                <button
                  key={player.id}
                  type="button"
                  onClick={() => setSelectedId(player.id)}
                  className={clsx(
                    "border-4 bg-endzone p-3 text-left hover:border-helmet",
                    player.id === selected?.id ? "border-helmet" : "border-yardline"
                  )}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-readable text-chalk truncate text-base sm:text-lg">{player.fullName}</span>
                    {typeof fam === "number" ? (
                      <span className="font-pixel text-helmet shrink-0 text-[0.55rem] sm:text-[0.7rem]">{fam}</span>
                    ) : null}
                  </div>
                  <span className="font-pixel text-helmet mt-2 block text-[0.5rem] sm:text-[0.55rem]">
                    {player.position} · {player.difficulty} · {player.careerStatus.replace("_", " ")}
                  </span>
                </button>
              );
            })}
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

              {selectedDebug ? (
                <DifficultyBreakdown
                  difficulty={selected.difficulty}
                  position={selected.position}
                  debug={selectedDebug}
                  thresholds={thresholds}
                />
              ) : (
                <p className="font-readable text-chalk-dim mt-6 text-base">Loading difficulty breakdown…</p>
              )}
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
