import clsx from "clsx";
import { Fragment, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";

import { findPlayerById, searchAllPlayers } from "@/lib/catalog";
import {
  buildDailyResultEmojis,
  buildDailyShareText,
  createInitialDailyProgress,
  difficultyLabel,
  getDailyChallengeForDate,
  getDailyStorageKey,
  getNextHintStep,
  getRevealButtonLabel,
  type DailyChallengeProgress,
  type DailyHintStep
} from "@/lib/daily-challenge";
import { NFL_TEAMS, formatTeamLabel } from "@/lib/nfl-teams";
import type { PlayerCatalogEntry, PlayerSearchResult, TeamStint } from "@/lib/types";
import { formatYearRange } from "@/lib/utils";

const DAILY_SHARE_URL = "https://nfl.pathguessr.app/daily";
const SHARE_POPUP_DELAY_MS = 2400;

type DailyFeedback = {
  kind: "correct" | "wrong" | "missed";
  message: string;
  detail?: string;
};

function readStoredProgress(key: string, player: PlayerCatalogEntry): DailyChallengeProgress {
  if (typeof window === "undefined") return createInitialDailyProgress(player);

  try {
    const stored = window.localStorage.getItem(key);
    if (!stored) return createInitialDailyProgress(player);

    const parsed = JSON.parse(stored) as Partial<DailyChallengeProgress>;
    if (parsed.playerId !== player.id) return createInitialDailyProgress(player);

    const consumedSteps = Array.isArray(parsed.consumedSteps)
      ? parsed.consumedSteps.filter((step): step is DailyHintStep => step === "team" || step === "years" || step === "position")
      : [];
    const maxRevealedStops = Math.max(1, Math.min(player.teamStints.length, Number(parsed.revealedStopCount) || 1));
    const status =
      parsed.status === "solved" || parsed.status === "gave_up" || parsed.status === "missed" ? parsed.status : "playing";

    return {
      playerId: player.id,
      revealedStopCount: status === "playing" ? maxRevealedStops : player.teamStints.length,
      yearsRevealed: status !== "playing" || Boolean(parsed.yearsRevealed),
      positionRevealed: status !== "playing" || Boolean(parsed.positionRevealed),
      consumedSteps,
      guessCount: Math.max(0, Number(parsed.guessCount) || 0),
      status,
      completedAt: typeof parsed.completedAt === "string" ? parsed.completedAt : null
    };
  } catch {
    return createInitialDailyProgress(player);
  }
}

function useDailyProgress(challenge: ReturnType<typeof getDailyChallengeForDate>) {
  const storageKey = challenge ? getDailyStorageKey(challenge.challengeNumber) : "";
  const [progress, setProgress] = useState<DailyChallengeProgress | null>(() =>
    challenge ? readStoredProgress(storageKey, challenge.player) : null
  );

  useEffect(() => {
    if (!challenge) return;
    setProgress(readStoredProgress(storageKey, challenge.player));
  }, [challenge, storageKey]);

  useEffect(() => {
    if (!challenge || !progress || typeof window === "undefined") return;
    window.localStorage.setItem(storageKey, JSON.stringify(progress));
  }, [challenge, progress, storageKey]);

  return [progress, setProgress] as const;
}

function applyRevealStep(player: PlayerCatalogEntry, progress: DailyChallengeProgress): DailyChallengeProgress {
  const nextStep = getNextHintStep(player, progress);
  if (!nextStep) return progress;

  return {
    ...progress,
    revealedStopCount:
      nextStep === "team" ? Math.min(player.teamStints.length, progress.revealedStopCount + 1) : progress.revealedStopCount,
    yearsRevealed: nextStep === "years" ? true : progress.yearsRevealed,
    positionRevealed: nextStep === "position" ? true : progress.positionRevealed,
    consumedSteps: [...progress.consumedSteps, nextStep]
  };
}

function completeProgress(progress: DailyChallengeProgress, status: "solved" | "gave_up" | "missed", player: PlayerCatalogEntry) {
  return {
    ...progress,
    revealedStopCount: player.teamStints.length,
    yearsRevealed: true,
    positionRevealed: true,
    status,
    completedAt: new Date().toISOString()
  };
}

function DifficultyTile({ difficulty }: { difficulty: PlayerCatalogEntry["difficulty"] }) {
  return (
    <span
      className={clsx(
        "font-pixel inline-flex border-4 px-3 py-2 text-[0.55rem] uppercase sm:text-xs",
        difficulty === "medium" ? "border-jersey-blue bg-helmet text-endzone" : "border-helmet bg-jersey-red text-white"
      )}
    >
      {difficultyLabel(difficulty)}
    </span>
  );
}

function DailyStopCard({
  stint,
  hidden,
  showYears
}: {
  stint: TeamStint;
  hidden: boolean;
  showYears: boolean;
}) {
  if (hidden) {
    return (
      <article className="flex w-[120px] flex-col items-center justify-center gap-1 border-4 border-yardline bg-endzone p-1.5 text-center sm:w-[148px] sm:gap-1.5 sm:p-2">
        <div className="font-pixel flex h-10 w-10 items-center justify-center border-4 border-helmet bg-turf-shadow text-xl text-helmet sm:h-12 sm:w-12">
          ?
        </div>
        <p className="font-pixel text-helmet flex items-center justify-center text-lg leading-tight sm:text-xl" style={{ minHeight: "2.5em" }}>
          ?
        </p>
      </article>
    );
  }

  const team = NFL_TEAMS[stint.teamId];
  return (
    <article
      className="flex w-[120px] flex-col items-center justify-center gap-1 border-4 p-1.5 text-center sm:w-[148px] sm:gap-1.5 sm:p-2"
      style={{ borderColor: team.primary, backgroundColor: "#58a045" }}
    >
      <img src={team.logoUrl} alt="" width={56} height={56} className="h-10 w-10 object-contain sm:h-12 sm:w-12" />
      <p className="font-readable text-[#0a2a14] flex items-center justify-center text-sm leading-tight sm:text-base" style={{ minHeight: "2.5em" }}>
        {formatTeamLabel(stint.teamId)}
      </p>
      {showYears ? (
        <p className="font-pixel text-white text-[0.5rem] leading-tight sm:text-[0.55rem]">
          {formatYearRange(stint.startYear, stint.endYear)}
        </p>
      ) : null}
    </article>
  );
}

function DailyPath({
  teamStints,
  revealedStopCount,
  showYears
}: {
  teamStints: TeamStint[];
  revealedStopCount: number;
  showYears: boolean;
}) {
  return (
    <div className="flex flex-wrap items-stretch justify-center gap-2 sm:gap-2.5">
      {teamStints.map((stint, index) => (
        <Fragment key={`${stint.teamId}-${index}-${stint.startYear}`}>
          {index > 0 ? (
            <span aria-hidden className="font-pixel text-helmet flex items-center text-base leading-none select-none sm:text-lg">
              ▶
            </span>
          ) : null}
          <DailyStopCard stint={stint} hidden={index >= revealedStopCount} showYears={showYears} />
        </Fragment>
      ))}
    </div>
  );
}

function SearchResults({
  results,
  onPick
}: {
  results: PlayerSearchResult[];
  onPick: (playerId: string) => void;
}) {
  if (results.length === 0) return null;

  return (
    <div className="mt-3 grid gap-2">
      {results.map((result) => (
        <button
          key={result.id}
          type="button"
          onClick={() => onPick(result.id)}
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
  );
}

function ShareDialog({
  shareText,
  resultLine,
  outcomeText,
  onClose
}: {
  shareText: string;
  resultLine: string;
  outcomeText: string;
  onClose: () => void;
}) {
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">("idle");

  async function copyResult() {
    try {
      await navigator.clipboard.writeText(shareText);
      setCopyStatus("copied");
    } catch {
      setCopyStatus("failed");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-endzone/85 px-3 sm:px-4">
      <div className="pixel-panel-accent w-full max-w-md p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-pixel text-helmet text-[0.55rem] sm:text-xs">▼ Share Result</p>
            <p className="font-readable text-chalk-dim mt-2 text-base sm:text-lg">Copy your daily line and send it around.</p>
          </div>
          <button type="button" onClick={onClose} className="pixel-button pixel-button-ghost shrink-0 px-3 py-2 text-[0.55rem]">
            ✕
          </button>
        </div>
        <pre className="font-readable mt-4 overflow-x-auto whitespace-pre-wrap border-4 border-yardline bg-endzone p-3 text-xl leading-tight text-chalk">
{shareText}
        </pre>
        <div
          className={clsx(
            "mt-3 border-4 p-3 text-center",
            outcomeText === "Solved" ? "border-good bg-good text-endzone" : "border-jersey-red bg-jersey-red text-white"
          )}
        >
          <p className="font-pixel text-[0.6rem] sm:text-xs">{outcomeText}</p>
        </div>
        <p className="font-readable text-chalk-dim mt-2 text-base">Result: {resultLine}</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <button type="button" onClick={copyResult} className="pixel-button pixel-button-primary">
            Copy
          </button>
          <button type="button" onClick={onClose} className="pixel-button pixel-button-secondary">
            Close
          </button>
        </div>
        {copyStatus !== "idle" ? (
          <p className={clsx("font-pixel mt-3 text-[0.55rem]", copyStatus === "copied" ? "text-good" : "text-jersey-red")}>
            {copyStatus === "copied" ? "Copied!" : "Copy failed"}
          </p>
        ) : null}
      </div>
    </div>
  );
}

export function DailyChallenge() {
  const challenge = useMemo(() => getDailyChallengeForDate(), []);
  const [progress, setProgress] = useDailyProgress(challenge);
  const [guessQuery, setGuessQuery] = useState("");
  const [feedback, setFeedback] = useState<DailyFeedback | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const shareTimerRef = useRef<number | null>(null);
  const deferredGuessQuery = useDeferredValue(guessQuery);
  const searchResults = useMemo(() => searchAllPlayers(deferredGuessQuery.trim(), 8), [deferredGuessQuery]);

  useEffect(() => {
    return () => {
      if (shareTimerRef.current !== null) {
        window.clearTimeout(shareTimerRef.current);
      }
    };
  }, []);

  if (!challenge || !progress) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col justify-center px-4 py-8 sm:px-6">
        <section className="pixel-panel-accent p-4 text-center sm:p-6">
          <p className="font-pixel text-helmet text-[0.6rem] sm:text-sm">Daily Challenge</p>
          <h1 className="font-pixel text-chalk mt-4 text-base sm:text-xl">No challenge available</h1>
          <p className="font-readable text-chalk-dim mt-3 text-lg">
            The current daily schedule is out of puzzles. Refresh the schedule before shipping more daily runs.
          </p>
          <Link to="/" className="pixel-button pixel-button-primary mt-5">
            Back Home
          </Link>
        </section>
      </main>
    );
  }

  const player = challenge.player;
  const completed = progress.status !== "playing";
  const visibleResults = completed ? [] : searchResults;
  const shareText = buildDailyShareText({ challenge, progress, url: DAILY_SHARE_URL });
  const resultLine = buildDailyResultEmojis(player, progress);
  const revealButtonLabel = getRevealButtonLabel(player, progress);
  const outcomeText = progress.status === "solved" ? "Solved" : progress.status === "missed" ? "Missed" : "Gave up";

  function openShareAfterDelay() {
    if (shareTimerRef.current !== null) {
      window.clearTimeout(shareTimerRef.current);
    }
    shareTimerRef.current = window.setTimeout(() => {
      setShareOpen(true);
      shareTimerRef.current = null;
    }, SHARE_POPUP_DELAY_MS);
  }

  function revealNext() {
    if (!progress || completed) return;

    const nextStep = getNextHintStep(player, progress);
    if (!nextStep) {
      giveUp();
      return;
    }

    setFeedback(null);
    setProgress((current) => (current ? applyRevealStep(player, current) : current));
  }

  function giveUp() {
    if (!progress || completed) return;
    setFeedback({
      kind: "missed",
      message: "Answer revealed",
      detail: "You gave up on today's challenge."
    });
    setProgress((current) => (current ? completeProgress(current, "gave_up", player) : current));
    openShareAfterDelay();
  }

  function submitGuess(playerId: string) {
    if (!progress || completed) return;

    const guessedPlayer = findPlayerById(playerId);
    if (!guessedPlayer) return;

    setGuessQuery("");

    if (playerId === player.id) {
      setFeedback({
        kind: "correct",
        message: "Touchdown! You got it!",
        detail: `${player.fullName} was today's player.`
      });
      setProgress((current) =>
        current
          ? completeProgress(
              {
                ...current,
                guessCount: current.guessCount + 1
              },
              "solved",
              player
            )
          : current
      );
      openShareAfterDelay();
      return;
    }

    const nextStep = getNextHintStep(player, progress);
    if (!nextStep) {
      setFeedback({
        kind: "missed",
        message: "No good. Answer revealed.",
        detail: `${guessedPlayer.fullName} was not today's player.`
      });
      setProgress((current) =>
        current
          ? completeProgress(
              {
                ...current,
                guessCount: current.guessCount + 1
              },
              "missed",
              player
            )
          : current
      );
      openShareAfterDelay();
      return;
    }

    setFeedback(
      nextStep === "position"
        ? {
            kind: "wrong",
            message: "Wrong guess. Final clue revealed.",
            detail: `${guessedPlayer.fullName} is not today's player. You get one final guess.`
          }
        : {
            kind: "wrong",
            message: "Wrong guess. Next clue revealed.",
            detail: `${guessedPlayer.fullName} is not today's player.`
          }
    );
    setProgress((current) =>
      current
        ? applyRevealStep(player, {
            ...current,
            guessCount: current.guessCount + 1
          })
        : current
    );
  }

  return (
    <main className="mx-auto min-h-screen w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link to="/" className="pixel-button pixel-button-ghost px-3 py-2 text-[0.55rem]">
          ◀ Home
        </Link>
        <button type="button" onClick={() => setShareOpen(true)} disabled={!completed} className="pixel-button pixel-button-secondary px-3 py-2 text-[0.55rem]">
          Share
        </button>
      </div>

      <section className="mx-auto mt-5 max-w-5xl">
        <div className="pixel-panel-accent p-4 sm:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="font-pixel text-helmet text-[0.55rem] sm:text-xs">▼ Daily Challenge #{challenge.challengeNumber}</p>
              <h1 className="font-pixel text-chalk mt-2 text-lg leading-tight sm:text-2xl">NFL Path Guesser</h1>
              <p className="font-readable text-chalk-dim mt-2 text-lg sm:text-xl">{challenge.dateLabel}</p>
            </div>
            <DifficultyTile difficulty={player.difficulty} />
          </div>

          <div className="mt-6 border-4 border-yardline bg-turf-shadow/70 p-3 sm:p-5">
            <DailyPath teamStints={player.teamStints} revealedStopCount={progress.revealedStopCount} showYears={progress.yearsRevealed} />
          </div>

          {progress.positionRevealed && !completed ? (
            <div className="mt-4 flex justify-center">
              <span className="pixel-tag pixel-tag-yellow">Position: {player.position}</span>
            </div>
          ) : null}

          {!completed ? (
            <div className="mx-auto mt-5 max-w-2xl">
              <label className="font-pixel text-chalk block text-[0.55rem] sm:text-[0.65rem]">
                Guess the player
                <input
                  value={guessQuery}
                  onChange={(event) => {
                    setGuessQuery(event.target.value);
                    if (!event.target.value.trim()) setFeedback(null);
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
                  className="pixel-input mt-2"
                />
              </label>

              {feedback ? (
                <div
                  className={clsx(
                    "mt-3 border-4 p-3",
                    feedback.kind === "correct"
                      ? "border-good bg-good text-endzone"
                      : feedback.kind === "missed"
                        ? "border-jersey-red bg-jersey-red text-white"
                        : "border-helmet bg-endzone text-chalk"
                  )}
                >
                  <p className="font-pixel text-[0.6rem] leading-relaxed sm:text-xs">{feedback.message}</p>
                  {feedback.detail ? <p className="font-readable mt-1 text-lg leading-tight">{feedback.detail}</p> : null}
                </div>
              ) : null}

              <SearchResults results={visibleResults} onPick={submitGuess} />

              <div className="mt-5 grid gap-3 sm:grid-cols-[1fr_auto]">
                <button type="button" onClick={revealNext} className="pixel-button pixel-button-primary">
                  {revealButtonLabel}
                </button>
                {getNextHintStep(player, progress) ? (
                  <button type="button" onClick={giveUp} className="pixel-button pixel-button-ghost">
                    Give Up
                  </button>
                ) : null}
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3">
                <div className="pixel-panel-flat p-3 text-center">
                  <p className="font-pixel text-helmet text-[0.5rem] sm:text-[0.55rem]">Guesses</p>
                  <p className="font-pixel text-chalk mt-2 text-lg">{progress.guessCount}</p>
                </div>
                <div className="pixel-panel-flat p-3 text-center">
                  <p className="font-pixel text-helmet text-[0.5rem] sm:text-[0.55rem]">Hints</p>
                  <p className="font-pixel text-chalk mt-2 text-lg">{progress.consumedSteps.length}</p>
                </div>
              </div>
            </div>
          ) : (
            <div className="mx-auto mt-6 max-w-3xl">
              {feedback ? (
                <div
                  className={clsx(
                    "mb-5 border-4 p-4 text-center",
                    feedback.kind === "correct" ? "border-good bg-good text-endzone" : "border-jersey-red bg-jersey-red text-white"
                  )}
                >
                  <p className="font-pixel text-sm leading-relaxed sm:text-lg">{feedback.message}</p>
                  {feedback.detail ? <p className="font-readable mt-2 text-xl leading-tight">{feedback.detail}</p> : null}
                </div>
              ) : null}
              <div className="grid gap-5 sm:grid-cols-[260px_1fr]">
              <div className="pixel-panel p-4 text-center">
                <img
                  src={player.headshotUrl}
                  alt=""
                  width={180}
                  height={180}
                  className="mx-auto h-40 w-40 border-4 border-yardline bg-endzone object-cover sm:h-44 sm:w-44"
                />
                <h2 className="font-pixel text-helmet mt-4 text-sm leading-tight sm:text-base">{player.fullName}</h2>
                <div className="mt-3 flex flex-wrap justify-center gap-2">
                  <span className="pixel-tag pixel-tag-blue">{player.position}</span>
                  <span className={clsx("pixel-tag", player.difficulty === "medium" ? "pixel-tag-yellow" : "pixel-tag-red")}>
                    {difficultyLabel(player.difficulty)}
                  </span>
                </div>
                <p className="font-readable text-chalk-dim mt-3 text-lg">
                  {progress.status === "solved" ? "Solved!" : progress.status === "missed" ? "Missed" : "Gave up"}
                </p>
                <p className="font-pixel text-chalk mt-2 text-[0.55rem]">{resultLine}</p>
              </div>
              <div className="pixel-panel p-4 sm:p-5">
                <p className="font-pixel text-helmet text-[0.55rem] sm:text-xs">▼ Daily Result</p>
                <div className="mt-4 grid grid-cols-2 gap-3">
                  <div className="pixel-panel-flat p-3 text-center">
                    <p className="font-pixel text-helmet text-[0.5rem] sm:text-[0.55rem]">Guesses</p>
                    <p className="font-pixel text-chalk mt-2 text-lg">{progress.guessCount}</p>
                  </div>
                  <div className="pixel-panel-flat p-3 text-center">
                    <p className="font-pixel text-helmet text-[0.5rem] sm:text-[0.55rem]">Hints</p>
                    <p className="font-pixel text-chalk mt-2 text-lg">{progress.consumedSteps.length + 1}</p>
                  </div>
                </div>
                <pre className="font-readable mt-4 overflow-x-auto whitespace-pre-wrap border-4 border-yardline bg-endzone p-3 text-xl leading-tight text-chalk">
{shareText}
                </pre>
                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  <button type="button" onClick={() => setShareOpen(true)} className="pixel-button pixel-button-primary">
                    Share Result
                  </button>
                  <Link to="/" className="pixel-button pixel-button-secondary">
                    Back Home
                  </Link>
                </div>
              </div>
              </div>
            </div>
          )}
        </div>
      </section>

      {shareOpen && completed ? (
        <ShareDialog shareText={shareText} resultLine={resultLine} outcomeText={outcomeText} onClose={() => setShareOpen(false)} />
      ) : null}
    </main>
  );
}
