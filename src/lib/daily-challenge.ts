import { CATALOG, findPlayerById, isCurrentPlayer } from "@/lib/catalog";
import { DAILY_CHALLENGE_SCHEDULE } from "@/lib/daily-challenge-schedule";
import type { Difficulty, PlayerCatalogEntry } from "@/lib/types";

export const DAILY_CHALLENGE_EPOCH_DATE = "2026-05-27";

const DAY_MS = 24 * 60 * 60 * 1000;
const RECENT_SEASON_WINDOW = 10;
const DEFENSE_POSITIONS = new Set(["CB", "DB", "DE", "DL", "DT", "EDGE", "FS", "ILB", "LB", "MLB", "NT", "OLB", "S", "SAF", "SS"]);
const SPECIAL_TEAMS_POSITIONS = new Set(["K", "P", "LS"]);
const SCHEDULED_DAILY_IDS = new Set<string>(DAILY_CHALLENGE_SCHEDULE);
const DAILY_ID_ALIASES: Record<string, string> = {
  "ced-wilson": "cedrick-wilson-jr"
};

export type DailyHintStep = "team" | "years" | "position";

export type DailyChallengeProgress = {
  playerId: string;
  revealedStopCount: number;
  yearsRevealed: boolean;
  positionRevealed: boolean;
  consumedSteps: DailyHintStep[];
  guessCount: number;
  status: "playing" | "solved" | "gave_up" | "missed";
  completedAt: string | null;
};

export type DailyChallenge = {
  challengeNumber: number;
  date: Date;
  dateLabel: string;
  player: PlayerCatalogEntry;
};

// The daily rolls over at midnight US Eastern (not UTC), so the puzzle changes
// at the same wall-clock moment for the bulk of the audience.
const DAILY_TIME_ZONE = "America/New_York";

// The Eastern calendar date for an instant, expressed as whole days since the
// Unix epoch. Two instants on the same Eastern day share an index.
function getZonedDayIndex(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: DAILY_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return Math.floor(Date.UTC(value("year"), value("month") - 1, value("day")) / DAY_MS);
}

const EPOCH_DAY_INDEX = (() => {
  const [year, month, day] = DAILY_CHALLENGE_EPOCH_DATE.split("-").map(Number);
  return Math.floor(Date.UTC(year, month - 1, day) / DAY_MS);
})();

export function getCareerEndYear(player: Pick<PlayerCatalogEntry, "teamStints">, currentYear = new Date().getUTCFullYear()) {
  return Math.max(...player.teamStints.map((stint) => stint.endYear ?? currentYear));
}

export function isDefenseOrSpecialTeams(position: string) {
  return DEFENSE_POSITIONS.has(position) || SPECIAL_TEAMS_POSITIONS.has(position);
}

export function isDailyEligible(player: PlayerCatalogEntry, currentYear = new Date().getUTCFullYear()) {
  if (player.teamStints.length < 3) return false;

  // Easy: any era (no recency restriction). Medium: current or retired within the
  // last 10 years. Hard: current players only. Impossible: never.
  if (player.difficulty === "easy") return true;
  if (player.difficulty === "medium") {
    return isCurrentPlayer(player) || getCareerEndYear(player, currentYear) >= currentYear - RECENT_SEASON_WINDOW;
  }
  if (player.difficulty === "hard") return isCurrentPlayer(player);
  return false;
}

export function getDailyCandidatePool(currentYear = new Date().getUTCFullYear()) {
  return CATALOG.filter((player) => isDailyEligible(player, currentYear));
}

export function getUnscheduledDailyCandidates(currentYear = new Date().getUTCFullYear()) {
  return getDailyCandidatePool(currentYear).filter((player) => !SCHEDULED_DAILY_IDS.has(player.id));
}

export function getChallengeNumberForDate(date = new Date()) {
  return getZonedDayIndex(date) - EPOCH_DAY_INDEX + 1;
}

export function getDateForChallengeNumber(challengeNumber: number) {
  return new Date((EPOCH_DAY_INDEX + challengeNumber - 1) * DAY_MS);
}

export function getDailyStorageKey(challengeNumber: number) {
  return `nfl-path-guesser:daily:${challengeNumber}`;
}

export function formatDailyDate(date: Date) {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC"
  }).format(date);
}

export function getDailyChallengeForDate(date = new Date()): DailyChallenge | null {
  const challengeNumber = getChallengeNumberForDate(date);
  return getDailyChallengeByNumber(challengeNumber);
}

export function getDailyChallengeByNumber(challengeNumber: number): DailyChallenge | null {
  if (challengeNumber < 1) return null;

  const playerId = DAILY_CHALLENGE_SCHEDULE[challengeNumber - 1];
  if (!playerId) return null;

  const player = findPlayerById(playerId) ?? findPlayerById(DAILY_ID_ALIASES[playerId] ?? "");
  // Once a daily ID is committed to the schedule, keep that date playable even
  // if later catalog scoring changes would move the player out of the current
  // eligibility pool. The schedule itself is the source of truth for dailies.
  if (!player) return null;

  const dayStart = getDateForChallengeNumber(challengeNumber);
  return {
    challengeNumber,
    date: dayStart,
    dateLabel: formatDailyDate(dayStart),
    player
  };
}

export function createInitialDailyProgress(player: PlayerCatalogEntry): DailyChallengeProgress {
  return {
    playerId: player.id,
    revealedStopCount: 1,
    yearsRevealed: false,
    positionRevealed: false,
    consumedSteps: [],
    guessCount: 0,
    status: "playing",
    completedAt: null
  };
}

export function getNextHintStep(player: PlayerCatalogEntry, progress: DailyChallengeProgress): DailyHintStep | null {
  if (progress.revealedStopCount < player.teamStints.length) return "team";
  if (!progress.yearsRevealed) return "years";
  if (!progress.positionRevealed) return "position";
  return null;
}

export function getRevealButtonLabel(player: PlayerCatalogEntry, progress: DailyChallengeProgress) {
  const nextStep = getNextHintStep(player, progress);
  if (nextStep === "team") return "Reveal Next Team";
  if (nextStep === "years") return "Reveal Years";
  if (nextStep === "position") return "Reveal Position";
  return "Give Up";
}

export function difficultyLabel(difficulty: Difficulty) {
  return difficulty.slice(0, 1).toUpperCase() + difficulty.slice(1);
}

function hintEmoji(step: DailyHintStep) {
  if (step === "team") return "🟨";
  if (step === "years") return "🕝";
  return "👤";
}

export function buildDailyResultEmojis(player: PlayerCatalogEntry, progress: DailyChallengeProgress) {
  const allHintSteps: DailyHintStep[] = [
    ...player.teamStints.map(() => "team" as const),
    "years",
    "position"
  ];
  const consumedHintSteps: DailyHintStep[] = ["team", ...progress.consumedSteps];
  const solvedIndex = progress.status === "solved" ? Math.min(consumedHintSteps.length - 1, allHintSteps.length - 1) : -1;
  const failed = progress.status === "gave_up" || progress.status === "missed";

  const hintResult = allHintSteps
    .map((_, index) => {
      if (index === solvedIndex) return "🟩";
      const consumed = consumedHintSteps[index];
      return consumed ? hintEmoji(consumed) : "⬛";
    })
    .join("");

  return failed ? `${hintResult}🟥` : hintResult;
}

export function buildDailyShareText({
  challenge,
  progress,
  url
}: {
  challenge: DailyChallenge;
  progress: DailyChallengeProgress;
  url: string;
}) {
  return [
    `NFL Path Guesser #${challenge.challengeNumber}`,
    challenge.dateLabel,
    difficultyLabel(challenge.player.difficulty),
    buildDailyResultEmojis(challenge.player, progress),
    url
  ].join("\n");
}
