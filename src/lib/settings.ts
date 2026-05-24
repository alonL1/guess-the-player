import type { RoomSettings } from "@/lib/types";

export const DEFAULT_ROOM_SETTINGS: RoomSettings = {
  roundCount: 5,
  timePerRoundSeconds: 30,
  difficulty: ["easy"],
  mode: "kahoot",
  showYears: true,
  showPosition: false,
  currentPlayersOnly: false,
  maxPlayers: 8,
  isPublic: true
};
