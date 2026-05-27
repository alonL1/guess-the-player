import { CATALOG, findPlayerById } from "@/lib/catalog";
import { DAILY_CHALLENGE_SCHEDULE } from "@/lib/daily-challenge-schedule";
import type { Difficulty, PlayerCatalogEntry } from "@/lib/types";

export const DAILY_CHALLENGE_EPOCH_DATE = "2026-05-27";

const DAY_MS = 24 * 60 * 60 * 1000;
const RECENT_SEASON_WINDOW = 10;
const DEFENSE_POSITIONS = new Set(["CB", "DB", "DE", "DL", "DT", "EDGE", "FS", "ILB", "LB", "MLB", "NT", "OLB", "S", "SAF", "SS"]);
const SPECIAL_TEAMS_POSITIONS = new Set(["K", "P", "LS"]);
const SCHEDULED_DAILY_IDS = new Set<string>(DAILY_CHALLENGE_SCHEDULE);

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

function parseUtcDate(dateInput: string) {
  const [year, month, day] = dateInput.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

function getUtcDayStart(date: Date) {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

export function getCareerEndYear(player: Pick<PlayerCatalogEntry, "teamStints">, currentYear = new Date().getUTCFullYear()) {
  return Math.max(...player.teamStints.map((stint) => stint.endYear ?? currentYear));
}

export function isCurrentPlayer(player: Pick<PlayerCatalogEntry, "teamStints">) {
  return player.teamStints.some((stint) => stint.endYear === null);
}

export function isDefenseOrSpecialTeams(position: string) {
  return DEFENSE_POSITIONS.has(position) || SPECIAL_TEAMS_POSITIONS.has(position);
}

export function isDailyEligible(player: PlayerCatalogEntry, currentYear = new Date().getUTCFullYear()) {
  if (player.teamStints.length < 4) return false;
  if (player.difficulty !== "medium" && player.difficulty !== "hard") return false;

  const current = isCurrentPlayer(player);
  const recent = current || getCareerEndYear(player, currentYear) >= currentYear - RECENT_SEASON_WINDOW;
  if (!recent) return false;

  if (player.difficulty === "medium") return true;
  return !isDefenseOrSpecialTeams(player.position) || current;
}

export function getDailyCandidatePool(currentYear = new Date().getUTCFullYear()) {
  return CATALOG.filter((player) => isDailyEligible(player, currentYear));
}

export function getUnscheduledDailyCandidates(currentYear = new Date().getUTCFullYear()) {
  return getDailyCandidatePool(currentYear).filter((player) => !SCHEDULED_DAILY_IDS.has(player.id));
}

export function getChallengeNumberForDate(date = new Date()) {
  const epoch = parseUtcDate(DAILY_CHALLENGE_EPOCH_DATE);
  const dayStart = getUtcDayStart(date);
  return Math.floor((dayStart - epoch) / DAY_MS) + 1;
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
  if (challengeNumber < 1) return null;

  const playerId = DAILY_CHALLENGE_SCHEDULE[challengeNumber - 1];
  if (!playerId) return null;

  const player = findPlayerById(playerId);
  if (!player || !isDailyEligible(player)) return null;

  const dayStart = new Date(getUtcDayStart(date));
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
