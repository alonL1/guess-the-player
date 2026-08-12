import type { RoomSettings } from "./types";

export const NBA_DEFAULT_ROOM_SETTINGS: RoomSettings = {
  roundCount: 5,
  timePerRoundSeconds: 30,
  difficulty: ["medium"],
  mode: "kahoot",
  showYears: true,
  showPosition: true,
  careerYearMode: "current",
  careerStartYear: 1976,
  careerEndYear: 2026,
  teamId: "all",
  positionGroup: "all",
  maxPlayers: 8,
  isPublic: true
};
