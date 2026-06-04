import type { PositionGroup } from "@/lib/types";

const OFFENSIVE_POSITIONS = new Set(["QB", "RB", "FB", "WR", "TE"]);
const DEFENSIVE_POSITIONS = new Set(["DL", "DE", "DT", "NT", "EDGE", "LB", "ILB", "OLB", "MLB", "CB", "DB", "S", "FS", "SS"]);
const SPECIAL_TEAMS_POSITIONS = new Set(["K", "P", "LS"]);

export const POSITION_GROUP_OPTIONS: PositionGroup[] = ["all", "offense", "defense", "special_teams"];

export function formatPositionGroup(positionGroup: PositionGroup) {
  if (positionGroup === "all") return "All positions";
  if (positionGroup === "special_teams") return "Special Teams";
  return positionGroup.charAt(0).toUpperCase() + positionGroup.slice(1);
}

export function isPositionInGroup(position: string, positionGroup: PositionGroup) {
  if (positionGroup === "all") return true;
  if (positionGroup === "offense") return OFFENSIVE_POSITIONS.has(position);
  if (positionGroup === "defense") return DEFENSIVE_POSITIONS.has(position);
  return SPECIAL_TEAMS_POSITIONS.has(position);
}
