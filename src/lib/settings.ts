import type { RoomSettings } from "@/lib/types";
import { CATALOG_YEAR_RANGE } from "@/lib/catalog";

export const DEFAULT_ROOM_SETTINGS: RoomSettings = {
  roundCount: 5,
  timePerRoundSeconds: 30,
  difficulty: ["medium"],
  mode: "kahoot",
  showYears: true,
  showPosition: true,
  careerYearMode: "full_career",
  careerStartYear: 1999,
  careerEndYear: CATALOG_YEAR_RANGE.max,
  teamId: "all",
  positionGroup: "all",
  maxPlayers: 8,
  isPublic: true
};
