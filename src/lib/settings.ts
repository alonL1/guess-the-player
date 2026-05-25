import type { RoomSettings } from "@/lib/types";

const CURRENT_YEAR = new Date().getUTCFullYear();

export const DEFAULT_ROOM_SETTINGS: RoomSettings = {
  roundCount: 5,
  timePerRoundSeconds: 30,
  difficulty: ["easy"],
  mode: "kahoot",
  showYears: true,
  showPosition: false,
  careerYearMode: "full_career",
  careerStartYear: 1999,
  careerEndYear: CURRENT_YEAR,
  teamId: "all",
  maxPlayers: 8,
  isPublic: true
};
