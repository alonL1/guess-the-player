import { createCatalogEngine, type PlayerFilters } from "@/lib/catalog-engine";
import { GENERATED_ACTIVE_PLAYERS } from "@/lib/active-generated-catalog";
import { isPositionInGroup } from "@/lib/positions";
import { IS_NBA } from "@/lib/sports";
import type { PlayerCatalogEntry } from "@/lib/types";

const rawPlayers = GENERATED_ACTIVE_PLAYERS as unknown as readonly PlayerCatalogEntry[];
export const CURRENT_CATALOG_YEAR = IS_NBA ? 2026 : new Date().getUTCFullYear();

export const {
  CATALOG,
  CATALOG_YEAR_RANGE,
  buildBalancedPlayerDeck,
  findPlayerById,
  findPlayersByName,
  getEligiblePlayers,
  isCurrentPlayer,
  searchAllPlayers,
  searchPlayers
} = createCatalogEngine({ rawPlayers, currentYear: CURRENT_CATALOG_YEAR, positionMatchesGroup: isPositionInGroup });

export type { PlayerFilters };
