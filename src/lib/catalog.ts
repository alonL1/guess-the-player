import { GENERATED_PLAYERS } from "@/lib/generated-player-catalog";
import type { Difficulty, PlayerCatalogEntry } from "@/lib/types";
import { createUiAvatarUrl, normalizeSearchText } from "@/lib/utils";

type GeneratedPlayer = Omit<PlayerCatalogEntry, "headshotUrl" | "normalizedName" | "uniqueTeamCount"> &
  Partial<Pick<PlayerCatalogEntry, "headshotUrl" | "normalizedName" | "uniqueTeamCount">>;

const RAW_PLAYERS: readonly GeneratedPlayer[] = GENERATED_PLAYERS;

function countUniqueTeams(player: Pick<PlayerCatalogEntry, "teamStints">) {
  return new Set(player.teamStints.map((team) => team.teamId)).size;
}

export const CATALOG: PlayerCatalogEntry[] = RAW_PLAYERS.map((player) => ({
  ...player,
  normalizedName: normalizeSearchText(player.fullName),
  headshotUrl: player.headshotUrl || createUiAvatarUrl(player.fullName),
  uniqueTeamCount: player.uniqueTeamCount || countUniqueTeams(player)
})).filter((player) => player.uniqueTeamCount > 1);

function isCurrentPlayer(player: PlayerCatalogEntry) {
  return player.teamStints.some((stint) => stint.endYear === null);
}

export function getEligiblePlayers(difficulties: Difficulty[], usedIds: string[], currentPlayersOnly = false) {
  const used = new Set(usedIds);
  return CATALOG.filter(
    (player) =>
      difficulties.includes(player.difficulty) &&
      !used.has(player.id) &&
      player.uniqueTeamCount > 1 &&
      (!currentPlayersOnly || isCurrentPlayer(player))
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

export function buildBalancedPlayerDeck(difficulties: Difficulty[], count: number, currentPlayersOnly = false, usedIds: string[] = []) {
  const uniqueDifficulties = [...new Set(difficulties)];
  const pools = new Map(
    uniqueDifficulties.map((difficulty) => [
      difficulty,
      shuffle(getEligiblePlayers([difficulty], usedIds, currentPlayersOnly))
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

export function searchPlayers(query: string, limit = 8, currentPlayersOnly = false) {
  const normalized = normalizeSearchText(query);
  if (!normalized) {
    return [];
  }

  return CATALOG.filter((player) => player.normalizedName.includes(normalized) && (!currentPlayersOnly || isCurrentPlayer(player)))
    .sort((left, right) => {
      const leftStarts = left.normalizedName.startsWith(normalized) ? 0 : 1;
      const rightStarts = right.normalizedName.startsWith(normalized) ? 0 : 1;
      if (leftStarts !== rightStarts) {
        return leftStarts - rightStarts;
      }
      return left.fullName.localeCompare(right.fullName);
    })
    .slice(0, limit)
    .map(({ id, fullName }) => ({ id, fullName }));
}
