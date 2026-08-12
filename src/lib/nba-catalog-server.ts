import { createCatalogEngine } from "./catalog-engine";
import { GENERATED_NBA_PLAYERS } from "./generated-nba-player-catalog";
import type { PlayerCatalogEntry, PositionGroup } from "./types";

const groups: Record<string, Set<string>> = {
  guards: new Set(["PG", "SG", "G", "G-F"]),
  wings: new Set(["SF", "F", "F-G", "G-F"]),
  bigs: new Set(["PF", "C", "F-C", "C-F"])
};

export const NBA_POSITION_GROUP_OPTIONS: PositionGroup[] = ["all", "guards", "wings", "bigs"];

export const NBA_CATALOG_ENGINE = createCatalogEngine({
  rawPlayers: GENERATED_NBA_PLAYERS as unknown as readonly PlayerCatalogEntry[],
  currentYear: 2026,
  positionMatchesGroup: (position, group) => group === "all" || Boolean(groups[group]?.has(position))
});
