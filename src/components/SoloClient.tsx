import clsx from "clsx";
import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { CATALOG_YEAR_RANGE, buildBalancedPlayerDeck, getEligiblePlayers, searchPlayers } from "@/lib/catalog";
import { NFL_TEAMS, formatTeamLabel } from "@/lib/nfl-teams";
import { calculateCurrentCap, calculateScore } from "@/lib/scoring";
import { DEFAULT_ROOM_SETTINGS } from "@/lib/settings";
import type { CareerYearMode, Difficulty, PlayerCatalogEntry, PlayerSearchResult, RoomSettings, TeamId, TeamStint } from "@/lib/types";
import { formatYearRange } from "@/lib/utils";

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
  const range = maxYear - minYear;
  const startPercent = ((startYear - minYear) / range) * 100;
  const endPercent = ((endYear - minYear) / range) * 100;
  const yearLabel = `${startYear}-${endYear === maxYear ? "Current" : endYear}`;
  const description =
    mode === "current"
      ? "Only active players in the current catalog are eligible."
      : mode === "entered"
      ? "Only players who entered the league inside this range are eligible."
      : mode === "retired"
        ? "Only players whose final catalog season is inside this range are eligible."
        : "Only players whose full career fits inside this range are eligible.";

  return (
    <div className="rounded-[1.25rem] border border-slate-200 bg-white p-4 text-sm text-slate-700">
      <div className="flex items-center justify-between gap-3">
        <span className="block text-xs uppercase tracking-[0.2em] text-slate-500">Career years</span>
        <button
          type="button"
          disabled={disabled}
          onClick={onReset}
          className="rounded-full border border-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-60"
        >
          Reset
        </button>
      </div>
      <select
        value={mode}
        disabled={disabled}
        onChange={(event) => onModeChange(event.target.value as CareerYearMode)}
        className="mt-3 w-full rounded-[0.9rem] border border-slate-200 bg-slate-50 px-3 py-2 outline-none focus:border-sky-300 disabled:opacity-60"
      >
        <option value="entered">Year Entering League</option>
        <option value="retired">Year Retired</option>
        <option value="full_career">Full Career</option>
        <option value="current">Current Players Only</option>
      </select>
      {mode !== "current" ? (
        <>
          <p className="mt-3 text-xs font-semibold text-slate-700">{yearLabel}</p>
          <div className="year-range-field mt-3">
            <div className="absolute left-0 right-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-slate-200" />
            <div
              className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-sky-500"
              style={{ left: `${startPercent}%`, right: `${100 - endPercent}%` }}
            />
            <input
              type="range"
              min={minYear}
              max={maxYear}
              value={startYear}
              disabled={disabled}
              onChange={(event) => {
                const nextStart = Math.min(Number(event.target.value), endYear);
                onChange({ careerStartYear: nextStart, careerEndYear: endYear });
              }}
              className="year-range-input"
              aria-label="Career start year"
            />
            <input
              type="range"
              min={minYear}
              max={maxYear}
              value={endYear}
              disabled={disabled}
              onChange={(event) => {
                const nextEnd = Math.max(Number(event.target.value), startYear);
                onChange({ careerStartYear: startYear, careerEndYear: nextEnd });
              }}
              className="year-range-input"
              aria-label="Career end year"
            />
          </div>
        </>
      ) : null}
      <p className="mt-3 text-xs leading-5 text-slate-500">{description}</p>
    </div>
  );
}

function TeamPathCards({ teamStints, showYears }: { teamStints: TeamStint[]; showYears: boolean }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:gap-3 md:grid-cols-3 xl:grid-cols-4">
      {teamStints.map((stint, index) => {
        const team = NFL_TEAMS[stint.teamId];
        return (
          <article
            key={`${stint.teamId}-${index}-${stint.startYear}`}
            className="rounded-[1rem] border border-slate-200 bg-white p-2.5 sm:rounded-[1.1rem] sm:p-3"
          >
            <div className="flex items-start gap-2">
              <img src={team.logoUrl} alt="" width={40} height={40} className="h-9 w-9 shrink-0 object-contain sm:h-10 sm:w-10" />
              <div className="min-w-0">
                <p className="text-[10px] uppercase tracking-[0.2em] text-slate-400">Stop {index + 1}</p>
                <h3 className="mt-1 text-sm font-semibold leading-tight text-slate-950 sm:mt-1.5 sm:text-base">
                  {formatTeamLabel(stint.teamId)}
                </h3>
              </div>
            </div>
            <p className="mt-0.5 text-[11px] text-slate-500 sm:text-xs">{stint.teamId}</p>
            {showYears ? (
              <p className="mt-1.5 text-[11px] font-medium text-slate-700 sm:mt-2 sm:text-xs">
                {formatYearRange(stint.startYear, stint.endYear)}
              </p>
            ) : null}
            <div className="mt-2 h-1 rounded-full sm:mt-3 sm:h-1.5" style={{ backgroundColor: team.primary }} />
          </article>
        );
      })}
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
    <div className="rounded-[1.25rem] border border-slate-200 bg-white p-4 text-sm text-slate-700">
      <span className="block text-xs uppercase tracking-[0.2em] text-slate-500">{label}</span>
      <button
        type="button"
        onClick={onClick}
        className={clsx(
          "mt-3 inline-flex w-full items-center justify-between rounded-[0.9rem] border px-3 py-2 text-left transition",
          active ? "border-sky-200 bg-sky-50 text-sky-700" : "border-slate-200 bg-slate-50 text-slate-700"
        )}
      >
        <span>{active ? activeLabel : inactiveLabel}</span>
        <span>{active ? "On" : "Off"}</span>
      </button>
    </div>
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
      setFeedback(`Wrong guess. Max remaining: ${calculateCurrentCap(round.wrongGuessCount + 1)}`);
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
    setFeedback(`Correct. Score: ${score}`);
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
      <div className="glass-panel rounded-[1.5rem] px-3 py-2.5 sm:px-5 sm:py-4">
        <div className="flex flex-wrap items-center justify-between gap-2 sm:gap-3">
          <div className="min-w-0">
            <Link
              to="/"
              className="text-[10px] font-semibold uppercase tracking-[0.22em] text-sky-700 sm:text-xs sm:tracking-[0.24em]"
            >
              NFL Path Guesser
            </Link>
            <h1 className="mt-1 text-base font-semibold text-slate-950 sm:text-2xl">Quick Solo Play</h1>
          </div>
          <Link
            to="/"
            className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-900 transition hover:bg-slate-50 sm:text-sm"
          >
            Back Home
          </Link>
        </div>
      </div>

      {status === "setup" ? (
        <section className="grid gap-4 lg:grid-cols-[0.95fr_1.05fr]">
          <div className="glass-panel rounded-[1.5rem] p-4 sm:p-6">
            <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500 sm:text-xs">Quick Solo Play</p>
            <h2 className="mt-1.5 text-2xl font-semibold text-slate-950 sm:mt-2 sm:text-4xl">Build a solo run</h2>
            <p className="mt-3 text-sm leading-6 text-slate-600 sm:text-base">
              Tune the pool, race the timer, and chase a clean score without creating a room.
            </p>

            <div className="mt-5 grid grid-cols-3 gap-2">
              <div className="rounded-[1.1rem] border border-slate-200 bg-white p-3">
                <p className="text-[10px] uppercase tracking-[0.18em] text-slate-400">Pool</p>
                <p className="mt-1 text-xl font-semibold text-slate-950">{eligiblePlayers.length}</p>
              </div>
              <div className="rounded-[1.1rem] border border-slate-200 bg-white p-3">
                <p className="text-[10px] uppercase tracking-[0.18em] text-slate-400">Rounds</p>
                <p className="mt-1 text-xl font-semibold text-slate-950">{settings.roundCount}</p>
              </div>
              <div className="rounded-[1.1rem] border border-slate-200 bg-white p-3">
                <p className="text-[10px] uppercase tracking-[0.18em] text-slate-400">Timer</p>
                <p className="mt-1 text-xl font-semibold text-slate-950">
                  {settings.timePerRoundSeconds === null ? "Off" : `${settings.timePerRoundSeconds}s`}
                </p>
              </div>
            </div>

            <button
              type="button"
              disabled={!canStart}
              onClick={startRun}
              className="mt-5 w-full rounded-full bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Start Solo Run
            </button>
            {!canStart ? (
              <p className="mt-3 text-sm text-rose-700">Select at least one difficulty with enough eligible players.</p>
            ) : null}
          </div>

          <div className="glass-panel rounded-[1.5rem] p-4 sm:p-6">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="rounded-[1.25rem] border border-slate-200 bg-white p-4 text-sm text-slate-700">
                <span className="block text-xs uppercase tracking-[0.2em] text-slate-500">Rounds</span>
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={settings.roundCount}
                  onChange={(event) => {
                    const parsed = Number(event.target.value);
                    updateSettings({ roundCount: Math.min(20, Math.max(1, Number.isNaN(parsed) ? 1 : parsed)) });
                  }}
                  className="mt-3 w-full rounded-[0.9rem] border border-slate-200 bg-slate-50 px-3 py-2 outline-none focus:border-sky-300"
                />
              </label>

              <label className="rounded-[1.25rem] border border-slate-200 bg-white p-4 text-sm text-slate-700">
                <span className="block text-xs uppercase tracking-[0.2em] text-slate-500">Timer</span>
                <select
                  value={settings.timePerRoundSeconds === null ? "none" : String(settings.timePerRoundSeconds)}
                  onChange={(event) =>
                    updateSettings({ timePerRoundSeconds: event.target.value === "none" ? null : Number(event.target.value) })
                  }
                  className="mt-3 w-full rounded-[0.9rem] border border-slate-200 bg-slate-50 px-3 py-2 outline-none focus:border-sky-300"
                >
                  <option value="none">No timer</option>
                  <option value="15">15 seconds</option>
                  <option value="30">30 seconds</option>
                  <option value="45">45 seconds</option>
                  <option value="60">60 seconds</option>
                </select>
              </label>

              <label className="rounded-[1.25rem] border border-slate-200 bg-white p-4 text-sm text-slate-700">
                <span className="block text-xs uppercase tracking-[0.2em] text-slate-500">Scoring</span>
                <select
                  value={settings.mode}
                  onChange={(event) => updateSettings({ mode: event.target.value as SoloSettings["mode"] })}
                  className="mt-3 w-full rounded-[0.9rem] border border-slate-200 bg-slate-50 px-3 py-2 outline-none focus:border-sky-300"
                >
                  <option value="kahoot">Time Based</option>
                  <option value="sudden_death">Sudden Death</option>
                </select>
              </label>

              <SettingToggle
                label="Years under teams"
                activeLabel="Showing years"
                inactiveLabel="Years hidden"
                active={settings.showYears}
                onClick={() => updateSettings({ showYears: !settings.showYears })}
              />
              <SettingToggle
                label="Position hint"
                activeLabel="Showing position"
                inactiveLabel="Position hidden"
                active={settings.showPosition}
                onClick={() => updateSettings({ showPosition: !settings.showPosition })}
              />
              <label className="rounded-[1.25rem] border border-slate-200 bg-white p-4 text-sm text-slate-700">
                <span className="block text-xs uppercase tracking-[0.2em] text-slate-500">Team</span>
                <select
                  value={settings.teamId}
                  onChange={(event) => updateSettings({ teamId: event.target.value as TeamId | "all" })}
                  className="mt-3 w-full rounded-[0.9rem] border border-slate-200 bg-slate-50 px-3 py-2 outline-none focus:border-sky-300"
                >
                  <option value="all">All teams</option>
                  {(Object.keys(NFL_TEAMS) as TeamId[]).map((teamId) => (
                    <option key={teamId} value={teamId}>
                      {formatTeamLabel(teamId)}
                    </option>
                  ))}
                </select>
              </label>
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

            <div className="mt-4 rounded-[1.25rem] border border-slate-200 bg-white p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Difficulty</p>
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
                        "rounded-full border px-3 py-2 text-sm font-semibold capitalize transition",
                        active ? "border-sky-300 bg-sky-100 text-sky-900" : "border-slate-200 bg-slate-50 text-slate-700"
                      )}
                    >
                      {difficulty}
                    </button>
                  );
                })}
              </div>
              <p className="mt-3 text-sm text-slate-500">{formatDifficulties(settings.difficulty)}</p>
            </div>
          </div>
        </section>
      ) : null}

      {status === "countdown" ? (
        <section className="glass-panel rounded-[1.5rem] px-4 py-10 text-center sm:px-8 sm:py-14">
          <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500 sm:text-xs">
            Round {round?.roundNumber}/{settings.roundCount}
          </p>
          <div className="mt-5 text-7xl font-semibold leading-none text-slate-950 sm:text-8xl">{countdownLabel}</div>
          <p className="mt-4 text-sm text-slate-600 sm:text-base">Lock in. Read the path fast.</p>
        </section>
      ) : null}

      {status === "active" && round ? (
        <section className="space-y-4">
          <div className="glass-panel rounded-[1.5rem] p-3 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                <span className="text-[10px] uppercase tracking-[0.22em] text-slate-500 sm:text-xs">
                  Round {round.roundNumber}/{settings.roundCount}
                </span>
                <span className="text-sm font-semibold text-slate-700">{timerLabel === null ? "No timer" : `${timerLabel}s`}</span>
                <span className="text-sm font-semibold text-sky-700">{totalScore} pts</span>
                <span className="text-[11px] text-slate-500 sm:text-xs">Max {currentCap}</span>
                {settings.showPosition ? (
                  <span className="rounded-full border border-sky-100 bg-sky-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-sky-800 sm:text-xs">
                    {round.player.position}
                  </span>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => revealRound("revealed")}
                className="rounded-full border border-sky-200 bg-sky-50 px-3 py-1.5 text-sm font-semibold text-sky-800"
              >
                Reveal
              </button>
            </div>
          </div>

          <div className="glass-panel rounded-[1.5rem] p-3 sm:p-5">
            <TeamPathCards teamStints={round.player.teamStints} showYears={settings.showYears} />
          </div>

          <div className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
            <div className="glass-panel rounded-[1.5rem] p-3 sm:p-5">
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
                placeholder="Search player names"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck={false}
                inputMode="search"
                className="w-full rounded-[1rem] border border-slate-200 bg-white px-4 py-3 text-slate-950 outline-none transition focus:border-sky-300"
              />

              {feedback ? (
                <div className="mt-3 rounded-[1.15rem] border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-800">
                  {feedback}
                </div>
              ) : null}

              {visibleSearchResults.length > 0 ? (
                <div className="mt-3 grid gap-2">
                  {visibleSearchResults.map((result) => (
                    <button
                      key={result.id}
                      type="button"
                      onClick={() => submitGuess(result.id)}
                      className="flex items-center gap-3 rounded-[1rem] border border-slate-200 bg-white px-3 py-2.5 text-left text-sm font-medium text-slate-800 transition hover:bg-slate-50"
                    >
                      <img
                        src={result.headshotUrl}
                        alt=""
                        width={40}
                        height={40}
                        className="h-10 w-10 shrink-0 rounded-full border border-slate-200 bg-slate-50 object-cover"
                      />
                      <span className="min-w-0">
                        <span className="block truncate">{result.fullName}</span>
                        <span className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">{result.position}</span>
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="glass-panel rounded-[1.5rem] p-4 sm:p-5">
              <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500 sm:text-xs">Run status</p>
              <div className="mt-4 grid grid-cols-2 gap-2">
                <div className="rounded-[1rem] border border-slate-200 bg-white p-3">
                  <p className="text-[10px] uppercase tracking-[0.18em] text-slate-400">Wrong</p>
                  <p className="mt-1 text-2xl font-semibold text-slate-950">{round.wrongGuessCount}</p>
                </div>
                <div className="rounded-[1rem] border border-slate-200 bg-white p-3">
                  <p className="text-[10px] uppercase tracking-[0.18em] text-slate-400">Correct</p>
                  <p className="mt-1 text-2xl font-semibold text-slate-950">{correctCount}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={resetRun}
                className="mt-4 w-full rounded-full border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                End Run
              </button>
            </div>
          </div>
        </section>
      ) : null}

      {status === "reveal" && round ? (
        <section className="glass-panel rounded-[1.5rem] p-4 sm:p-6">
          <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500 sm:text-xs">
            Round {round.roundNumber}/{settings.roundCount} · Reveal
          </p>
          <div className="mt-4 grid gap-4 sm:mt-5 sm:gap-6 lg:grid-cols-[240px_1fr] lg:items-start">
            <div className="mx-auto w-40 overflow-hidden rounded-[1.4rem] border border-slate-200 bg-slate-50 sm:w-56 lg:mx-0 lg:w-auto">
              <img src={round.player.headshotUrl} alt={round.player.fullName} width={320} height={320} className="h-auto w-full object-cover" />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-sky-700 sm:text-sm">Answer</p>
              <h2 className="mt-1.5 break-words text-2xl font-semibold text-slate-950 sm:mt-2 sm:text-3xl lg:text-4xl">
                {round.player.fullName}
              </h2>
              <div className="mt-2 flex flex-wrap gap-2">
                {settings.showPosition ? (
                  <span className="rounded-full border border-sky-100 bg-sky-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-sky-800 sm:text-sm">
                    {round.player.position}
                  </span>
                ) : null}
                <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold capitalize tracking-[0.08em] text-slate-700 sm:text-sm">
                  {round.player.difficulty}
                </span>
                <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700 sm:text-sm">
                  +{results.find((result) => result.roundNumber === round.roundNumber)?.score ?? 0}
                </span>
              </div>
              <div className="mt-4 sm:mt-5">
                <TeamPathCards teamStints={round.player.teamStints} showYears />
              </div>
              <button
                type="button"
                onClick={continueRun}
                className="mt-5 w-full rounded-full bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 sm:w-auto"
              >
                {round.roundNumber >= settings.roundCount ? "See Summary" : "Next Round"}
              </button>
            </div>
          </div>
        </section>
      ) : null}

      {status === "summary" ? (
        <section className="grid gap-4 lg:grid-cols-[0.85fr_1.15fr]">
          <div className="glass-panel rounded-[1.5rem] p-4 sm:p-6">
            <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500 sm:text-xs">Final score</p>
            <h2 className="mt-2 text-5xl font-semibold text-slate-950">{totalScore}</h2>
            <div className="mt-5 grid grid-cols-2 gap-2">
              <div className="rounded-[1rem] border border-slate-200 bg-white p-3">
                <p className="text-[10px] uppercase tracking-[0.18em] text-slate-400">Correct</p>
                <p className="mt-1 text-2xl font-semibold text-slate-950">{correctCount}</p>
              </div>
              <div className="rounded-[1rem] border border-slate-200 bg-white p-3">
                <p className="text-[10px] uppercase tracking-[0.18em] text-slate-400">Missed</p>
                <p className="mt-1 text-2xl font-semibold text-slate-950">{missedCount}</p>
              </div>
            </div>
            <div className="mt-5 grid gap-2">
              <button
                type="button"
                onClick={startRun}
                className="rounded-full bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800"
              >
                Run It Back
              </button>
              <button
                type="button"
                onClick={resetRun}
                className="rounded-full border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                Change Settings
              </button>
            </div>
          </div>

          <div className="glass-panel rounded-[1.5rem] p-4 sm:p-6">
            <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500 sm:text-xs">Round breakdown</p>
            <div className="mt-4 grid gap-2.5">
              {results.map((result) => (
                <div key={result.roundNumber} className="rounded-[1.1rem] border border-slate-200 bg-white p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-xs text-slate-500">Round {result.roundNumber}</p>
                      <p className="font-semibold text-slate-950">{result.player.fullName}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-lg font-semibold text-slate-950">+{result.score}</p>
                      <p className="text-xs capitalize text-slate-500">{result.outcome}</p>
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
