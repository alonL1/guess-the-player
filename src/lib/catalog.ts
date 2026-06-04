import { GENERATED_PLAYERS } from "@/lib/generated-player-catalog";
import { isPositionInGroup } from "@/lib/positions";
import type { CareerYearMode, Difficulty, PlayerCatalogEntry, PlayerSearchResult, PositionGroup, TeamId } from "@/lib/types";
import { createUiAvatarUrl, normalizeSearchText } from "@/lib/utils";

type GeneratedPlayer = Omit<PlayerCatalogEntry, "headshotUrl" | "normalizedName" | "uniqueTeamCount"> &
  Partial<Pick<PlayerCatalogEntry, "headshotUrl" | "normalizedName" | "uniqueTeamCount">>;

const RAW_PLAYERS: readonly GeneratedPlayer[] = GENERATED_PLAYERS;
const CURRENT_CATALOG_YEAR = new Date().getUTCFullYear();

export type PlayerFilters = {
  careerYearMode: CareerYearMode;
  careerStartYear: number;
  careerEndYear: number;
  teamId: TeamId | "all";
  positionGroup: PositionGroup;
};

function countUniqueTeams(player: Pick<PlayerCatalogEntry, "teamStints">) {
  return new Set(player.teamStints.map((team) => team.teamId)).size;
}

export const CATALOG: PlayerCatalogEntry[] = RAW_PLAYERS.map((player) => ({
  ...player,
  normalizedName: normalizeSearchText(player.fullName),
  headshotUrl: player.headshotUrl || createUiAvatarUrl(player.fullName),
  uniqueTeamCount: player.uniqueTeamCount || countUniqueTeams(player)
})).filter((player) => player.uniqueTeamCount > 1);

export const CATALOG_YEAR_RANGE = CATALOG.reduce(
  (range, player) => {
    const startYear = getCareerStartYear(player);
    const endYear = getCareerEndYear(player);
    return {
      min: Math.min(range.min, startYear),
      max: Math.max(range.max, endYear)
    };
  },
  { min: CURRENT_CATALOG_YEAR, max: CURRENT_CATALOG_YEAR }
);

function getCareerStartYear(player: PlayerCatalogEntry) {
  return Math.min(...player.teamStints.map((stint) => stint.startYear));
}

function getCareerEndYear(player: PlayerCatalogEntry) {
  return Math.max(...player.teamStints.map((stint) => stint.endYear ?? CURRENT_CATALOG_YEAR));
}

function isCurrentPlayer(player: PlayerCatalogEntry) {
  return player.teamStints.some((stint) => stint.endYear === null);
}

function matchesFilters(player: PlayerCatalogEntry, filters: PlayerFilters) {
  if (!isPositionInGroup(player.position, filters.positionGroup)) {
    return false;
  }

  if (filters.careerYearMode === "current") {
    const matchesTeam = filters.teamId === "all" || player.teamStints.some((stint) => stint.teamId === filters.teamId);
    return isCurrentPlayer(player) && matchesTeam;
  }

  const careerStartYear = getCareerStartYear(player);
  const careerEndYear = getCareerEndYear(player);
  const careerStartsInsideRange = careerStartYear >= filters.careerStartYear && careerStartYear <= filters.careerEndYear;
  const careerEndsInsideRange = careerEndYear >= filters.careerStartYear && careerEndYear <= filters.careerEndYear;
  const fullCareerInsideRange = careerStartYear >= filters.careerStartYear && careerEndYear <= filters.careerEndYear;
  const matchesTeam = filters.teamId === "all" || player.teamStints.some((stint) => stint.teamId === filters.teamId);
  const matchesYears =
    filters.careerYearMode === "entered"
      ? careerStartsInsideRange
      : filters.careerYearMode === "retired"
        ? careerEndsInsideRange
        : fullCareerInsideRange;
  return matchesYears && matchesTeam;
}

export function getEligiblePlayers(difficulties: Difficulty[], usedIds: string[], filters: PlayerFilters) {
  const used = new Set(usedIds);
  return CATALOG.filter(
    (player) =>
      difficulties.includes(player.difficulty) &&
      !used.has(player.id) &&
      player.uniqueTeamCount > 1 &&
      matchesFilters(player, filters)
  );
}

function shuffle<T>(items: T[]) {
  const next = [...items];
  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
  }
  return next;
}

export function buildBalancedPlayerDeck(difficulties: Difficulty[], count: number, filters: PlayerFilters, usedIds: string[] = []) {
  const uniqueDifficulties = [...new Set(difficulties)];
  const pools = new Map(
    uniqueDifficulties.map((difficulty) => [
      difficulty,
      shuffle(getEligiblePlayers([difficulty], usedIds, filters))
    ])
  );
  const difficultyOrder = shuffle(uniqueDifficulties);
  const deck: PlayerCatalogEntry[] = [];

  while (deck.length < count) {
    let pickedThisPass = false;

    for (const difficulty of difficultyOrder) {
      if (deck.length >= count) break;
      const pool = pools.get(difficulty);
      const next = pool?.shift();
      if (!next) continue;
      deck.push(next);
      pickedThisPass = true;
    }

    if (!pickedThisPass) break;
  }

  return shuffle(deck);
}

export function findPlayerById(playerId: string) {
  return CATALOG.find((player) => player.id === playerId) ?? null;
}

export function findPlayersByName(query: string, limit = 12) {
  const normalized = normalizeSearchText(query);
  if (!normalized) {
    return [];
  }

  return CATALOG.filter((player) => player.normalizedName.includes(normalized))
    .sort((left, right) => {
      const leftExact = left.normalizedName === normalized ? 0 : 1;
      const rightExact = right.normalizedName === normalized ? 0 : 1;
      if (leftExact !== rightExact) return leftExact - rightExact;

      const leftStarts = left.normalizedName.startsWith(normalized) ? 0 : 1;
      const rightStarts = right.normalizedName.startsWith(normalized) ? 0 : 1;
      if (leftStarts !== rightStarts) return leftStarts - rightStarts;

      return left.fullName.localeCompare(right.fullName);
    })
    .slice(0, limit);
}

export function searchPlayers(query: string, limit = 8, filters: PlayerFilters): PlayerSearchResult[] {
  const normalized = normalizeSearchText(query);
  if (!normalized) {
    return [];
  }

  return CATALOG.filter((player) => player.normalizedName.includes(normalized) && matchesFilters(player, filters))
    .sort((left, right) => {
      const leftStarts = left.normalizedName.startsWith(normalized) ? 0 : 1;
      const rightStarts = right.normalizedName.startsWith(normalized) ? 0 : 1;
      if (leftStarts !== rightStarts) {
        return leftStarts - rightStarts;
      }
      return left.fullName.localeCompare(right.fullName);
    })
    .slice(0, limit)
    .map(({ id, fullName, position, headshotUrl }) => ({ id, fullName, position, headshotUrl }));
}

export function searchAllPlayers(query: string, limit = 8): PlayerSearchResult[] {
  const normalized = normalizeSearchText(query);
  if (!normalized) {
    return [];
  }

  return CATALOG.filter((player) => player.normalizedName.includes(normalized))
    .sort((left, right) => {
      const leftExact = left.normalizedName === normalized ? 0 : 1;
      const rightExact = right.normalizedName === normalized ? 0 : 1;
      if (leftExact !== rightExact) return leftExact - rightExact;

      const leftStarts = left.normalizedName.startsWith(normalized) ? 0 : 1;
      const rightStarts = right.normalizedName.startsWith(normalized) ? 0 : 1;
      if (leftStarts !== rightStarts) {
        return leftStarts - rightStarts;
      }
      return left.fullName.localeCompare(right.fullName);
    })
    .slice(0, limit)
    .map(({ id, fullName, position, headshotUrl }) => ({ id, fullName, position, headshotUrl }));
}
