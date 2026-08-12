import { ACTIVE_SPORT } from "@/lib/sports";
import type { PositionGroup } from "@/lib/types";

const OFFENSIVE_POSITIONS = new Set(["QB", "RB", "FB", "WR", "TE"]);
const DEFENSIVE_POSITIONS = new Set(["DL", "DE", "DT", "NT", "EDGE", "LB", "ILB", "OLB", "MLB", "CB", "DB", "S", "FS", "SS"]);
const SPECIAL_TEAMS_POSITIONS = new Set(["K", "P", "LS"]);

const GUARD_POSITIONS = new Set(["PG", "SG", "G", "G-F"]);
const WING_POSITIONS = new Set(["SF", "F", "F-G", "G-F"]);
const BIG_POSITIONS = new Set(["PF", "C", "F-C", "C-F"]);

export const POSITION_GROUP_OPTIONS: PositionGroup[] = ACTIVE_SPORT.positionGroups;

export function formatPositionGroup(positionGroup: PositionGroup) {
  if (positionGroup === "all") return "All positions";
  if (positionGroup === "special_teams") return "Special Teams";
  if (positionGroup === "guards") return "Guards";
  if (positionGroup === "wings") return "Wings";
  if (positionGroup === "bigs") return "Bigs";
  return positionGroup.charAt(0).toUpperCase() + positionGroup.slice(1);
}

export function isPositionInGroup(position: string, positionGroup: PositionGroup) {
  if (positionGroup === "all") return true;
  if (positionGroup === "offense") return OFFENSIVE_POSITIONS.has(position);
  if (positionGroup === "defense") return DEFENSIVE_POSITIONS.has(position);
  if (positionGroup === "special_teams") return SPECIAL_TEAMS_POSITIONS.has(position);
  if (positionGroup === "guards") return GUARD_POSITIONS.has(position);
  if (positionGroup === "wings") return WING_POSITIONS.has(position);
  return BIG_POSITIONS.has(position);
}
