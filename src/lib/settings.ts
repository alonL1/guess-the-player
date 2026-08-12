import type { RoomSettings } from "@/lib/types";
import { CATALOG_YEAR_RANGE } from "@/lib/catalog";
import { IS_NBA } from "@/lib/sports";

export const DEFAULT_ROOM_SETTINGS: RoomSettings = {
  roundCount: 5,
  timePerRoundSeconds: 30,
  difficulty: ["medium"],
  mode: "kahoot",
  showYears: true,
  showPosition: true,
  careerYearMode: "current",
  careerStartYear: IS_NBA ? Math.max(1976, CATALOG_YEAR_RANGE.min) : 1999,
  careerEndYear: CATALOG_YEAR_RANGE.max,
  teamId: "all",
  positionGroup: "all",
  maxPlayers: 8,
  isPublic: true
};
