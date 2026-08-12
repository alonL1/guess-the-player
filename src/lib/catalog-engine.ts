import type { CareerYearMode, Difficulty, PlayerCatalogEntry, PlayerSearchResult, PositionGroup, TeamId } from "@/lib/types";
import { createUiAvatarUrl, normalizeSearchText } from "@/lib/utils";

export type PlayerFilters = {
  careerYearMode: CareerYearMode;
  careerStartYear: number;
  careerEndYear: number;
  teamId: TeamId | "all";
  positionGroup: PositionGroup;
};

type GeneratedPlayer = Omit<PlayerCatalogEntry, "headshotUrl" | "normalizedName" | "uniqueTeamCount" | "careerStatus"> &
  Partial<Pick<PlayerCatalogEntry, "headshotUrl" | "normalizedName" | "uniqueTeamCount" | "careerStatus">>;

export function createCatalogEngine({
  rawPlayers,
  currentYear,
  positionMatchesGroup
}: {
  rawPlayers: readonly GeneratedPlayer[];
  currentYear: number;
  positionMatchesGroup: (position: string, group: PositionGroup) => boolean;
}) {
  const countUniqueTeams = (player: Pick<PlayerCatalogEntry, "teamStints">) =>
    new Set(player.teamStints.map((team) => team.teamId)).size;
  const getCareerStartYear = (player: PlayerCatalogEntry) => Math.min(...player.teamStints.map((stint) => stint.startYear));
  const getCareerEndYear = (player: PlayerCatalogEntry) =>
    Math.max(...player.teamStints.map((stint) => stint.endYear ?? currentYear));
  const isCurrentPlayer = (player: Pick<PlayerCatalogEntry, "careerStatus">) =>
    player.careerStatus === "signed" || player.careerStatus === "free_agent";

  const CATALOG: PlayerCatalogEntry[] = rawPlayers
    .map((player) => ({
      ...player,
      careerStatus: player.careerStatus ?? (player.teamStints.some((stint) => stint.endYear === null) ? "signed" : "retired"),
      normalizedName: normalizeSearchText(player.fullName),
      headshotUrl: player.headshotUrl || createUiAvatarUrl(player.fullName),
      uniqueTeamCount: player.uniqueTeamCount || countUniqueTeams(player)
    }))
    .filter((player) => player.uniqueTeamCount > 1);

  const CATALOG_YEAR_RANGE = CATALOG.reduce(
    (range, player) => ({
      min: Math.min(range.min, getCareerStartYear(player)),
      max: Math.max(range.max, getCareerEndYear(player))
    }),
    { min: currentYear, max: currentYear }
  );

  function matchesFilters(player: PlayerCatalogEntry, filters: PlayerFilters) {
    if (!positionMatchesGroup(player.position, filters.positionGroup)) return false;
    const matchesTeam = filters.teamId === "all" || player.teamStints.some((stint) => stint.teamId === filters.teamId);
    if (!matchesTeam) return false;
    if (filters.careerYearMode === "current") return isCurrentPlayer(player);

    const careerStartYear = getCareerStartYear(player);
    const careerEndYear = getCareerEndYear(player);
    if (filters.careerYearMode === "entered") return careerStartYear >= filters.careerStartYear && careerStartYear <= filters.careerEndYear;
    if (filters.careerYearMode === "retired") {
      return !isCurrentPlayer(player) && careerEndYear >= filters.careerStartYear && careerEndYear <= filters.careerEndYear;
    }
    return careerStartYear >= filters.careerStartYear && careerEndYear <= filters.careerEndYear;
  }

  function getEligiblePlayers(difficulties: Difficulty[], usedIds: string[], filters: PlayerFilters) {
    const used = new Set(usedIds);
    return CATALOG.filter((player) =>
      difficulties.includes(player.difficulty) && !used.has(player.id) && matchesFilters(player, filters)
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

  function buildBalancedPlayerDeck(difficulties: Difficulty[], count: number, filters: PlayerFilters, usedIds: string[] = []) {
    const uniqueDifficulties = [...new Set(difficulties)];
    const pools = new Map(uniqueDifficulties.map((difficulty) => [difficulty, shuffle(getEligiblePlayers([difficulty], usedIds, filters))]));
    const difficultyOrder = shuffle(uniqueDifficulties);
    const deck: PlayerCatalogEntry[] = [];
    while (deck.length < count) {
      let picked = false;
      for (const difficulty of difficultyOrder) {
        if (deck.length >= count) break;
        const next = pools.get(difficulty)?.shift();
        if (!next) continue;
        deck.push(next);
        picked = true;
      }
      if (!picked) break;
    }
    return shuffle(deck);
  }

  const findPlayerById = (playerId: string) => CATALOG.find((player) => player.id === playerId) ?? null;

  function sortedNameMatches(query: string, filters?: PlayerFilters) {
    const normalized = normalizeSearchText(query);
    if (!normalized) return [];
    return CATALOG.filter((player) => player.normalizedName.includes(normalized) && (!filters || matchesFilters(player, filters)))
      .sort((left, right) => {
        const exact = Number(left.normalizedName !== normalized) - Number(right.normalizedName !== normalized);
        if (exact) return exact;
        const starts = Number(!left.normalizedName.startsWith(normalized)) - Number(!right.normalizedName.startsWith(normalized));
        return starts || left.fullName.localeCompare(right.fullName);
      });
  }

  const findPlayersByName = (query: string, limit = 12) => sortedNameMatches(query).slice(0, limit);
  const toSearchResults = (players: PlayerCatalogEntry[]): PlayerSearchResult[] =>
    players.map(({ id, fullName, position, headshotUrl }) => ({ id, fullName, position, headshotUrl }));
  const searchPlayers = (query: string, limit = 8, filters: PlayerFilters) =>
    toSearchResults(sortedNameMatches(query, filters).slice(0, limit));
  const searchAllPlayers = (query: string, limit = 8) => toSearchResults(sortedNameMatches(query).slice(0, limit));

  return {
    CATALOG,
    CATALOG_YEAR_RANGE,
    buildBalancedPlayerDeck,
    findPlayerById,
    findPlayersByName,
    getEligiblePlayers,
    isCurrentPlayer,
    searchAllPlayers,
    searchPlayers
  };
}
