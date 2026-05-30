import clsx from "clsx";
import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { CATALOG_YEAR_RANGE, buildBalancedPlayerDeck, getEligiblePlayers, searchPlayers } from "@/lib/catalog";
import { NFL_TEAMS, formatTeamLabel } from "@/lib/nfl-teams";
import { calculateCurrentCap, calculateScore } from "@/lib/scoring";
import { DEFAULT_ROOM_SETTINGS } from "@/lib/settings";
import type { CareerYearMode, Difficulty, PlayerCatalogEntry, PlayerSearchResult, RoomSettings, TeamId } from "@/lib/types";
import { TeamPath } from "@/components/TeamPath";

const DIFFICULTY_OPTIONS: Difficulty[] = ["easy", "medium", "hard", "impossible"];
const COUNTDOWN_MS = 3000;

type SoloStatus = "setup" | "countdown" | "active" | "reveal" | "summary";

type SoloSettings = Pick<
  RoomSettings,
  | "roundCount"
  | "timePerRoundSeconds"
  | "difficulty"
  | "mode"
  | "showYears"
  | "showPosition"
  | "careerYearMode"
  | "careerStartYear"
  | "careerEndYear"
  | "teamId"
>;

type SoloRound = {
  roundNumber: number;
  player: PlayerCatalogEntry;
  countdownEndsAt: number | null;
  startedAt: number | null;
  endsAt: number | null;
  wrongGuessCount: number;
};

type SoloResult = {
  roundNumber: number;
  player: PlayerCatalogEntry;
  score: number;
  wrongGuessCount: number;
  outcome: "correct" | "timeout" | "revealed";
};

const INITIAL_SETTINGS: SoloSettings = {
  roundCount: DEFAULT_ROOM_SETTINGS.roundCount,
  timePerRoundSeconds: DEFAULT_ROOM_SETTINGS.timePerRoundSeconds,
  difficulty: [...DEFAULT_ROOM_SETTINGS.difficulty],
  mode: DEFAULT_ROOM_SETTINGS.mode,
  showYears: DEFAULT_ROOM_SETTINGS.showYears,
  showPosition: DEFAULT_ROOM_SETTINGS.showPosition,
  careerYearMode: DEFAULT_ROOM_SETTINGS.careerYearMode,
  careerStartYear: DEFAULT_ROOM_SETTINGS.careerStartYear,
  careerEndYear: DEFAULT_ROOM_SETTINGS.careerEndYear,
  teamId: DEFAULT_ROOM_SETTINGS.teamId
};

function getTimerLabel(round: SoloRound | null, now: number | null) {
  if (!round?.endsAt || now === null) return null;
  return Math.max(0, Math.ceil((round.endsAt - now) / 1000));
}

function getCountdownLabel(round: SoloRound | null, now: number | null) {
  if (!round?.countdownEndsAt || now === null) return null;
  return Math.max(1, Math.ceil((round.countdownEndsAt - now) / 1000));
}

function formatDifficulties(difficulties: Difficulty[]) {
  if (difficulties.length === 0) return "No difficulties";
  return difficulties.map((difficulty) => difficulty.charAt(0).toUpperCase() + difficulty.slice(1)).join(", ");
}

function getPlayerFilters(settings: Pick<RoomSettings, "careerYearMode" | "careerStartYear" | "careerEndYear" | "teamId">) {
  return {
    careerYearMode: settings.careerYearMode,
    careerStartYear: settings.careerStartYear,
    careerEndYear: settings.careerEndYear,
    teamId: settings.teamId
  };
}

function SettingCard({
  label,
  children
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="pixel-panel-flat p-3 sm:p-4">
      <p className="font-pixel text-helmet text-[0.5rem] sm:text-[0.625rem]">{label}</p>
      <div className="mt-3">{children}</div>
    </div>
  );
}

function YearRangeSlider({
  mode,
  startYear,
  endYear,
  disabled,
  onModeChange,
  onReset,
  onChange
}: {
  mode: CareerYearMode;
  startYear: number;
  endYear: number;
  disabled?: boolean;
  onModeChange: (mode: CareerYearMode) => void;
  onReset: () => void;
  onChange: (next: { careerStartYear: number; careerEndYear: number }) => void;
}) {
  const minYear = CATALOG_YEAR_RANGE.min;
  const maxYear = CATALOG_YEAR_RANGE.max;
  const safeStartYear = Math.min(Math.max(startYear, minYear), maxYear);
  const safeEndYear = Math.min(Math.max(endYear, safeStartYear), maxYear);
  const range = Math.max(maxYear - minYear, 1);
  const startPercent = ((safeStartYear - minYear) / range) * 100;
  const endPercent = ((safeEndYear - minYear) / range) * 100;
  const yearLabel = `${safeStartYear}-${safeEndYear === maxYear ? "Current" : safeEndYear}`;
  const description =
    mode === "current"
      ? "Only active players in the current catalog are eligible."
      : mode === "entered"
        ? "Only players who entered the league inside this range are eligible."
        : mode === "retired"
          ? "Only players whose final catalog season is inside this range are eligible."
          : "Only players whose full career fits inside this range are eligible.";

  return (
    <div className="pixel-panel-flat p-3 sm:p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="font-pixel text-helmet text-[0.5rem] sm:text-[0.625rem]">Career years</p>
        <button
          type="button"
          disabled={disabled}
          onClick={onReset}
          className="pixel-button pixel-button-ghost min-h-0 px-2 py-1 text-[0.5rem]"
        >
          Reset
        </button>
      </div>
      <select
        value={mode}
        disabled={disabled}
        onChange={(event) => onModeChange(event.target.value as CareerYearMode)}
        className="pixel-select mt-3"
      >
        <option value="entered">Year Entering League</option>
        <option value="retired">Year Retired</option>
        <option value="full_career">Full Career</option>
        <option value="current">Current Players Only</option>
      </select>
      {mode !== "current" ? (
        <>
          <p className="font-pixel text-chalk mt-3 text-[0.5rem] sm:text-[0.625rem]">{yearLabel}</p>
          <div className="year-range-field mt-3">
            <div className="absolute left-0 right-0 top-1/2 h-2 -translate-y-1/2 border-2 border-yardline bg-endzone" />
            <div
              className="absolute top-1/2 h-2 -translate-y-1/2 bg-helmet"
              style={{ left: `${startPercent}%`, right: `${100 - endPercent}%` }}
            />
            <input
              type="range"
              min={minYear}
              max={maxYear}
              value={safeStartYear}
              disabled={disabled}
              onChange={(event) => {
                const nextStart = Math.min(Number(event.target.value), safeEndYear);
                onChange({ careerStartYear: nextStart, careerEndYear: safeEndYear });
              }}
              className="year-range-input"
              aria-label="Career start year"
            />
            <input
              type="range"
              min={minYear}
              max={maxYear}
              value={safeEndYear}
              disabled={disabled}
              onChange={(event) => {
                const nextEnd = Math.max(Number(event.target.value), safeStartYear);
                onChange({ careerStartYear: safeStartYear, careerEndYear: nextEnd });
              }}
              className="year-range-input"
              aria-label="Career end year"
            />
          </div>
        </>
      ) : null}
      <p className="font-readable text-chalk-dim mt-3 text-base leading-tight">{description}</p>
    </div>
  );
}

function SettingToggle({
  label,
  activeLabel,
  inactiveLabel,
  active,
  onClick
}: {
  label: string;
  activeLabel: string;
  inactiveLabel: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <SettingCard label={label}>
      <button
        type="button"
        onClick={onClick}
        className={clsx(
          "pixel-button w-full justify-between",
          active ? "pixel-button-accent" : "pixel-button-ghost"
        )}
      >
        <span className="text-left">{active ? activeLabel : inactiveLabel}</span>
        <span>{active ? "ON" : "OFF"}</span>
      </button>
    </SettingCard>
  );
}

export function SoloClient() {
  const [settings, setSettings] = useState<SoloSettings>(INITIAL_SETTINGS);
  const [status, setStatus] = useState<SoloStatus>("setup");
  const [deck, setDeck] = useState<PlayerCatalogEntry[]>([]);
  const [round, setRound] = useState<SoloRound | null>(null);
  const [results, setResults] = useState<SoloResult[]>([]);
  const [guessQuery, setGuessQuery] = useState("");
  const deferredGuessQuery = useDeferredValue(guessQuery);
  const [searchResults, setSearchResults] = useState<PlayerSearchResult[]>([]);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [now, setNow] = useState<number | null>(null);
  const playerFilters = useMemo(
    () => getPlayerFilters(settings),
    [settings.careerEndYear, settings.careerStartYear, settings.careerYearMode, settings.teamId]
  );

  const eligiblePlayers = useMemo(
    () => getEligiblePlayers(settings.difficulty, [], playerFilters),
    [playerFilters, settings.difficulty]
  );
  const canStart = settings.difficulty.length > 0 && eligiblePlayers.length >= settings.roundCount;
  const totalScore = results.reduce((sum, result) => sum + result.score, 0);
  const correctCount = results.filter((result) => result.outcome === "correct").length;
  const missedCount = results.length - correctCount;
  const timerLabel = getTimerLabel(round, now);
  const countdownLabel = getCountdownLabel(round, now);
  const currentCap = round && settings.mode === "kahoot" ? calculateCurrentCap(round.wrongGuessCount) : 1000;
  const visibleSearchResults = status === "active" && deferredGuessQuery.trim() ? searchResults : [];
  const isFinalCountdown = countdownLabel === 1;

  useEffect(() => {
    const handle = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(handle);
  }, []);

  useEffect(() => {
    if (status !== "countdown" || !round?.countdownEndsAt) return;
    const delay = Math.max(0, round.countdownEndsAt - Date.now());
    const handle = window.setTimeout(() => {
      const startedAt = Date.now();
      setRound((current) =>
        current
          ? {
              ...current,
              countdownEndsAt: null,
              startedAt,
              endsAt: settings.timePerRoundSeconds === null ? null : startedAt + settings.timePerRoundSeconds * 1000
            }
          : current
      );
      setStatus("active");
    }, delay);
    return () => window.clearTimeout(handle);
  }, [round?.countdownEndsAt, settings.timePerRoundSeconds, status]);

  useEffect(() => {
    if (status !== "active" || !round?.endsAt || now === null || now < round.endsAt) return;
    revealRound("timeout");
  }, [now, round?.endsAt, status]);

  useEffect(() => {
    if (!deferredGuessQuery.trim() || status !== "active") return;
    setSearchResults(searchPlayers(deferredGuessQuery.trim(), 8, playerFilters));
  }, [deferredGuessQuery, playerFilters, status]);

  function updateSettings(next: Partial<SoloSettings>) {
    setSettings((current) => ({ ...current, ...next }));
  }

  function beginRound(nextRoundNumber: number, nextDeck = deck) {
    const player = nextDeck[nextRoundNumber - 1];
    if (!player) {
      setStatus("summary");
      return;
    }
    setRound({
      roundNumber: nextRoundNumber,
      player,
      countdownEndsAt: Date.now() + COUNTDOWN_MS,
      startedAt: null,
      endsAt: null,
      wrongGuessCount: 0
    });
    setGuessQuery("");
    setSearchResults([]);
    setFeedback(null);
    setStatus("countdown");
  }

  function startRun() {
    if (!canStart) return;
    const nextDeck = buildBalancedPlayerDeck(settings.difficulty, settings.roundCount, playerFilters);
    setDeck(nextDeck);
    setResults([]);
    beginRound(1, nextDeck);
  }

  function revealRound(outcome: SoloResult["outcome"], score = 0) {
    if (!round || status === "reveal") return;
    setResults((current) => {
      if (current.some((result) => result.roundNumber === round.roundNumber)) return current;
      return [
        ...current,
        {
          roundNumber: round.roundNumber,
          player: round.player,
          score,
          wrongGuessCount: round.wrongGuessCount,
          outcome
        }
      ];
    });
    setGuessQuery("");
    setSearchResults([]);
    setStatus("reveal");
  }

  function submitGuess(playerId: string) {
    if (!round || status !== "active") return;
    if (playerId !== round.player.id) {
      setRound((current) => (current ? { ...current, wrongGuessCount: current.wrongGuessCount + 1 } : current));
      setFeedback(`Wrong. Max remaining: ${calculateCurrentCap(round.wrongGuessCount + 1)}`);
      return;
    }

    const score = calculateScore({
      mode: settings.mode,
      wrongGuessCount: round.wrongGuessCount,
      remainingTimeFraction:
        settings.timePerRoundSeconds !== null && round.endsAt
          ? Math.max(0, (round.endsAt - Date.now()) / (settings.timePerRoundSeconds * 1000))
          : undefined,
      correctOrder: 1
    });
    setFeedback(`Correct! +${score}`);
    revealRound("correct", score);
  }

  function continueRun() {
    if (!round) return;
    if (round.roundNumber >= settings.roundCount) {
      setStatus("summary");
      return;
    }
    beginRound(round.roundNumber + 1);
  }

  function resetRun() {
    setStatus("setup");
    setDeck([]);
    setRound(null);
    setResults([]);
    setGuessQuery("");
    setSearchResults([]);
    setFeedback(null);
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-3 px-3 py-3 sm:gap-4 sm:px-6 sm:py-6">
      <div className="scoreboard px-3 py-3 sm:px-5 sm:py-4">
        <div className="flex flex-wrap items-center justify-between gap-2 sm:gap-3">
          <div className="min-w-0">
            <Link to="/" className="font-pixel text-helmet text-[0.5rem] sm:text-[0.625rem]">
              ◀ NFL Path Guesser
            </Link>
            <h1 className="font-pixel text-helmet mt-2 text-xs sm:text-lg">SOLO RUN</h1>
          </div>
          <Link
            to="/"
            className="pixel-button pixel-button-ghost min-h-0 px-3 py-2 text-[0.5rem] sm:text-[0.625rem]"
          >
            ↩ Home
          </Link>
        </div>
      </div>

      {status === "setup" ? (
        <section className="grid gap-4 lg:grid-cols-[0.95fr_1.05fr]">
          <div className="pixel-panel-accent p-4 sm:p-5">
            <p className="font-pixel text-helmet text-[0.55rem] sm:text-xs">▼ Quick Solo Play</p>
            <h2 className="font-pixel text-chalk mt-3 text-base sm:text-2xl">Build a solo run</h2>
            <p className="font-readable text-chalk-dim mt-3 text-base leading-snug">
              Tune the pool, race the timer, and chase a clean score without creating a room.
            </p>

            <div className="mt-5 grid grid-cols-3 gap-2 sm:gap-3">
              <div className="pixel-panel-flat p-3 text-center">
                <p className="font-pixel text-helmet text-[0.45rem] sm:text-[0.55rem]">Pool</p>
                <p className="font-pixel text-chalk mt-2 text-sm sm:text-lg">{eligiblePlayers.length}</p>
              </div>
              <div className="pixel-panel-flat p-3 text-center">
                <p className="font-pixel text-helmet text-[0.45rem] sm:text-[0.55rem]">Rounds</p>
                <p className="font-pixel text-chalk mt-2 text-sm sm:text-lg">{settings.roundCount}</p>
              </div>
              <div className="pixel-panel-flat p-3 text-center">
                <p className="font-pixel text-helmet text-[0.45rem] sm:text-[0.55rem]">Timer</p>
                <p className="font-pixel text-chalk mt-2 text-sm sm:text-lg">
                  {settings.timePerRoundSeconds === null ? "Off" : `${settings.timePerRoundSeconds}s`}
                </p>
              </div>
            </div>

            <button
              type="button"
              disabled={!canStart}
              onClick={startRun}
              className="pixel-button pixel-button-primary mt-5 w-full"
            >
              ▶ Start Solo Run
            </button>
            {!canStart ? (
              <p className="font-readable text-jersey-red mt-3 text-base">
                Select at least one difficulty with enough eligible players.
              </p>
            ) : null}
          </div>

          <div className="pixel-panel p-4 sm:p-5">
            <div className="grid gap-3 sm:gap-4 sm:grid-cols-2">
              <SettingCard label="Rounds">
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={settings.roundCount}
                  onChange={(event) => {
                    const parsed = Number(event.target.value);
                    updateSettings({ roundCount: Math.min(20, Math.max(1, Number.isNaN(parsed) ? 1 : parsed)) });
                  }}
                  className="pixel-input"
                />
              </SettingCard>

              <SettingCard label="Timer">
                <select
                  value={settings.timePerRoundSeconds === null ? "none" : String(settings.timePerRoundSeconds)}
                  onChange={(event) =>
                    updateSettings({ timePerRoundSeconds: event.target.value === "none" ? null : Number(event.target.value) })
                  }
                  className="pixel-select"
                >
                  <option value="none">No timer</option>
                  <option value="15">15 seconds</option>
                  <option value="30">30 seconds</option>
                  <option value="45">45 seconds</option>
                  <option value="60">60 seconds</option>
                </select>
              </SettingCard>

              <SettingCard label="Scoring">
                <select
                  value={settings.mode}
                  onChange={(event) => updateSettings({ mode: event.target.value as SoloSettings["mode"] })}
                  className="pixel-select"
                >
                  <option value="kahoot">Time Based</option>
                  <option value="sudden_death">Sudden Death</option>
                </select>
              </SettingCard>

              <SettingToggle
                label="Years Under Teams"
                activeLabel="Showing years"
                inactiveLabel="Years hidden"
                active={settings.showYears}
                onClick={() => updateSettings({ showYears: !settings.showYears })}
              />
              <SettingToggle
                label="Position Hint"
                activeLabel="Showing position"
                inactiveLabel="Position hidden"
                active={settings.showPosition}
                onClick={() => updateSettings({ showPosition: !settings.showPosition })}
              />
              <SettingCard label="Team">
                <select
                  value={settings.teamId}
                  onChange={(event) => updateSettings({ teamId: event.target.value as TeamId | "all" })}
                  className="pixel-select"
                >
                  <option value="all">All teams</option>
                  {(Object.keys(NFL_TEAMS) as TeamId[]).map((teamId) => (
                    <option key={teamId} value={teamId}>
                      {formatTeamLabel(teamId)}
                    </option>
                  ))}
                </select>
              </SettingCard>
            </div>

            <div className="mt-4">
              <YearRangeSlider
                mode={settings.careerYearMode}
                startYear={settings.careerStartYear}
                endYear={settings.careerEndYear}
                onModeChange={(careerYearMode) => updateSettings({ careerYearMode })}
                onReset={() =>
                  updateSettings({
                    careerYearMode: DEFAULT_ROOM_SETTINGS.careerYearMode,
                    careerStartYear: DEFAULT_ROOM_SETTINGS.careerStartYear,
                    careerEndYear: DEFAULT_ROOM_SETTINGS.careerEndYear
                  })
                }
                onChange={updateSettings}
              />
            </div>

            <div className="pixel-panel-flat mt-4 p-3 sm:p-4">
              <p className="font-pixel text-helmet text-[0.5rem] sm:text-[0.625rem]">Difficulty</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {DIFFICULTY_OPTIONS.map((difficulty) => {
                  const active = settings.difficulty.includes(difficulty);
                  return (
                    <button
                      key={difficulty}
                      type="button"
                      onClick={() => {
                        const nextDifficulty = active
                          ? settings.difficulty.filter((value) => value !== difficulty)
                          : [...settings.difficulty, difficulty];
                        updateSettings({ difficulty: nextDifficulty });
                      }}
                      className={clsx(
                        "pixel-button min-h-0 px-3 py-2 text-[0.55rem] capitalize",
                        active ? "pixel-button-accent" : "pixel-button-ghost"
                      )}
                    >
                      {difficulty}
                    </button>
                  );
                })}
              </div>
              <p className="font-readable text-chalk-dim mt-3 text-base">{formatDifficulties(settings.difficulty)}</p>
            </div>
          </div>
        </section>
      ) : null}

      {status === "countdown" ? (
        <section className="scoreboard scanline px-4 py-10 text-center sm:px-8 sm:py-14">
          <p className="font-pixel text-helmet text-[0.625rem] sm:text-sm">
            ROUND {round?.roundNumber}/{settings.roundCount}
          </p>
          <div
            className={clsx("font-pixel text-helmet mt-6 leading-none", isFinalCountdown && "blink")}
            style={{ fontSize: "var(--fs-display)" }}
          >
            {countdownLabel}
          </div>
          <p className="font-pixel text-chalk mt-6 text-[0.55rem] sm:text-xs">LOCK IN. READ THE PATH FAST.</p>
        </section>
      ) : null}

      {status === "active" && round ? (
        <section className="space-y-4">
          <div className="scoreboard px-3 py-3 sm:px-5 sm:py-3">
            <div className="flex flex-wrap items-center justify-between gap-2 sm:gap-3">
              <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                <span className="font-pixel text-helmet text-[0.55rem] sm:text-xs">
                  RND {round.roundNumber}/{settings.roundCount}
                </span>
                <span
                  className={clsx(
                    "font-pixel text-[0.625rem] sm:text-sm",
                    typeof timerLabel === "number" && timerLabel <= 5 ? "text-jersey-red blink" : "text-chalk"
                  )}
                >
                  {timerLabel === null ? "NO TIMER" : `${timerLabel}s`}
                </span>
                <span className="font-pixel text-good text-[0.55rem] sm:text-xs">{totalScore} PTS</span>
                <span className="font-pixel text-chalk-dim text-[0.5rem] sm:text-[0.625rem]">MAX {currentCap}</span>
                {settings.showPosition ? (
                  <span className="pixel-tag pixel-tag-yellow">{round.player.position}</span>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => revealRound("revealed")}
                className="pixel-button pixel-button-accent min-h-0 px-3 py-2 text-[0.55rem]"
              >
                Reveal
              </button>
            </div>
          </div>

          <div className="pixel-panel p-3 sm:p-4">
            <TeamPath teamStints={round.player.teamStints} showYears={settings.showYears} />
          </div>

          <div className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
            <div className="pixel-panel p-3 sm:p-4">
              <input
                value={guessQuery}
                onChange={(event) => {
                  const nextValue = event.target.value;
                  setGuessQuery(nextValue);
                  if (!nextValue.trim()) setSearchResults([]);
                }}
                onKeyDown={(event) => {
                  if (event.key !== "Enter") return;
                  const normalized = guessQuery.trim().toLowerCase();
                  const exactMatch = searchResults.find((result) => result.fullName.toLowerCase() === normalized);
                  if (exactMatch) {
                    event.preventDefault();
                    submitGuess(exactMatch.id);
                  }
                }}
                placeholder="TYPE PLAYER NAME"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck={false}
                inputMode="search"
                className="pixel-input"
              />

              {feedback ? (
                <div
                  className={clsx(
                    "mt-3 border-4 p-3",
                    feedback.startsWith("Wrong") ? "border-jersey-red bg-endzone" : "border-good bg-endzone"
                  )}
                >
                  <p
                    className={clsx(
                      "font-pixel text-[0.55rem] sm:text-xs",
                      feedback.startsWith("Wrong") ? "text-jersey-red" : "text-good"
                    )}
                  >
                    {feedback}
                  </p>
                </div>
              ) : null}

              {visibleSearchResults.length > 0 ? (
                <div className="mt-3 grid gap-2">
                  {visibleSearchResults.map((result) => (
                    <button
                      key={result.id}
                      type="button"
                      onClick={() => submitGuess(result.id)}
                      className="flex items-center gap-3 border-4 border-yardline bg-endzone p-2 text-left hover:border-helmet"
                    >
                      <img
                        src={result.headshotUrl}
                        alt=""
                        width={40}
                        height={40}
                        className="h-10 w-10 shrink-0 border-2 border-yardline bg-endzone object-cover"
                      />
                      <span className="min-w-0">
                        <span className="font-readable text-chalk block truncate text-base sm:text-lg">{result.fullName}</span>
                        <span className="font-pixel text-helmet text-[0.5rem] sm:text-[0.55rem]">{result.position}</span>
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="pixel-panel p-4 sm:p-5">
              <p className="font-pixel text-helmet text-[0.55rem] sm:text-xs">▼ Run Status</p>
              <div className="mt-4 grid grid-cols-2 gap-2 sm:gap-3">
                <div className="pixel-panel-flat p-3 text-center">
                  <p className="font-pixel text-jersey-red text-[0.45rem] sm:text-[0.55rem]">Wrong</p>
                  <p className="font-pixel text-chalk mt-2 text-lg sm:text-xl">{round.wrongGuessCount}</p>
                </div>
                <div className="pixel-panel-flat p-3 text-center">
                  <p className="font-pixel text-good text-[0.45rem] sm:text-[0.55rem]">Correct</p>
                  <p className="font-pixel text-chalk mt-2 text-lg sm:text-xl">{correctCount}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={resetRun}
                className="pixel-button pixel-button-ghost mt-4 w-full"
              >
                End Run
              </button>
            </div>
          </div>
        </section>
      ) : null}

      {status === "reveal" && round ? (
        <section className="pixel-panel-accent p-4 sm:p-6">
          <p className="font-pixel text-helmet text-[0.55rem] sm:text-xs">
            ▼ Round {round.roundNumber}/{settings.roundCount} · Reveal
          </p>
          <div className="mt-4 grid gap-4 sm:mt-5 sm:gap-6 lg:grid-cols-[240px_1fr] lg:items-start">
            <div className="mx-auto w-40 overflow-hidden border-4 border-helmet bg-endzone sm:w-56 lg:mx-0 lg:w-auto">
              <img
                src={round.player.headshotUrl}
                alt={round.player.fullName}
                width={320}
                height={320}
                className="h-auto w-full object-cover"
              />
            </div>
            <div>
              <p className="font-pixel text-good text-[0.55rem] sm:text-xs">▼ ANSWER</p>
              <h2 className="font-pixel text-chalk mt-2 break-words text-base sm:text-xl lg:text-2xl">
                {round.player.fullName}
              </h2>
              <div className="mt-3 flex flex-wrap gap-2">
                {settings.showPosition ? (
                  <span className="pixel-tag pixel-tag-yellow">{round.player.position}</span>
                ) : null}
                <span className="pixel-tag pixel-tag-blue capitalize">{round.player.difficulty}</span>
                <span className="pixel-tag pixel-tag-green">
                  +{results.find((result) => result.roundNumber === round.roundNumber)?.score ?? 0}
                </span>
              </div>
              <div className="mt-4 sm:mt-5">
                <TeamPath teamStints={round.player.teamStints} showYears />
              </div>
              <button
                type="button"
                onClick={continueRun}
                className="pixel-button pixel-button-primary mt-5 w-full sm:w-auto"
              >
                {round.roundNumber >= settings.roundCount ? "See Summary ▶" : "Next Round ▶"}
              </button>
            </div>
          </div>
        </section>
      ) : null}

      {status === "summary" ? (
        <section className="grid gap-4 lg:grid-cols-[0.85fr_1.15fr]">
          <div className="pixel-panel-accent p-4 sm:p-6">
            <p className="font-pixel text-helmet text-[0.55rem] sm:text-xs">▼ Final Score</p>
            <h2 className="font-pixel text-helmet mt-3 text-3xl sm:text-5xl">{totalScore}</h2>
            <div className="mt-5 grid grid-cols-2 gap-2 sm:gap-3">
              <div className="pixel-panel-flat p-3 text-center">
                <p className="font-pixel text-good text-[0.45rem] sm:text-[0.55rem]">Correct</p>
                <p className="font-pixel text-chalk mt-2 text-lg sm:text-xl">{correctCount}</p>
              </div>
              <div className="pixel-panel-flat p-3 text-center">
                <p className="font-pixel text-jersey-red text-[0.45rem] sm:text-[0.55rem]">Missed</p>
                <p className="font-pixel text-chalk mt-2 text-lg sm:text-xl">{missedCount}</p>
              </div>
            </div>
            <div className="mt-5 grid gap-3">
              <button
                type="button"
                onClick={startRun}
                className="pixel-button pixel-button-primary"
              >
                ▶ Run It Back
              </button>
              <button
                type="button"
                onClick={resetRun}
                className="pixel-button pixel-button-ghost"
              >
                Change Settings
              </button>
            </div>
          </div>

          <div className="pixel-panel p-4 sm:p-6">
            <p className="font-pixel text-helmet text-[0.55rem] sm:text-xs">▼ Round Breakdown</p>
            <div className="mt-4 grid gap-2">
              {results.map((result) => (
                <div key={result.roundNumber} className="border-4 border-yardline bg-endzone p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-pixel text-helmet text-[0.5rem] sm:text-[0.55rem]">RND {result.roundNumber}</p>
                      <p className="font-readable text-chalk mt-1 truncate text-base sm:text-lg">{result.player.fullName}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="font-pixel text-helmet text-sm sm:text-lg">+{result.score}</p>
                      <p
                        className={clsx(
                          "font-pixel mt-1 text-[0.45rem] capitalize sm:text-[0.55rem]",
                          result.outcome === "correct"
                            ? "text-good"
                            : result.outcome === "revealed"
                              ? "text-helmet"
                              : "text-jersey-red"
                        )}
                      >
                        {result.outcome}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      ) : null}
    </main>
  );
}
