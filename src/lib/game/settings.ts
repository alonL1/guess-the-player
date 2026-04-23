import type { RoomSettings } from "@/lib/types";

export const DEFAULT_ROOM_SETTINGS: RoomSettings = {
  roundCount: 5,
  timePerRoundSeconds: 30,
  difficulty: ["easy", "medium"],
  mode: "kahoot",
  showYears: false,
  maxPlayers: 8,
  isPublic: true
};
