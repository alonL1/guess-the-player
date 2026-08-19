import { NBA_TEAMS } from "@/lib/nba-teams";
import { NFL_TEAMS } from "@/lib/nfl-teams";
import type { PositionGroup, SportId, TeamId } from "@/lib/types";

export type SportDefinition = {
  id: SportId;
  league: string;
  title: string;
  subtitle: string;
  publicUrl: string;
  shareUrl: string;
  teams: Record<string, { name: string; city: string; abbreviation: TeamId; primary: string; secondary: string; logoUrl: string }>;
  positionGroups: PositionGroup[];
  nicknamePlaceholder: string;
  knowledgePrompt: string;
  correctMessage: string;
  countdownMessage: string;
  inspectorTitle: string;
};

export const SPORTS: Record<SportId, SportDefinition> = {
  nfl: {
    id: "nfl",
    league: "NFL",
    title: "NFL Path Guesser",
    subtitle: "Guess the player from the career path",
    publicUrl: "https://nfl.pathguessr.app",
    shareUrl: "https://nfl.pathguessr.app/daily",
    teams: NFL_TEAMS,
    positionGroups: ["all", "offense", "defense", "special_teams"],
    nicknamePlaceholder: "GRIDIRON GURU",
    knowledgePrompt: "Test your ball knowledge!",
    correctMessage: "Touchdown! You got it!",
    countdownMessage: "Read the path. Beat the buzzer.",
    inspectorTitle: "NFL Player Catalog"
  },
  nba: {
    id: "nba",
    league: "NBA",
    title: "NBA Path Guesser",
    subtitle: "Guess the player from the career path",
    publicUrl: "https://nba.pathguessr.app",
    shareUrl: "https://nba.pathguessr.app/daily",
    teams: NBA_TEAMS,
    positionGroups: ["all", "guards", "wings", "bigs"],
    nicknamePlaceholder: "PAINT PROFESSOR",
    knowledgePrompt: "Test your hoops knowledge!",
    correctMessage: "Swish! You got it!",
    countdownMessage: "Read the path. Beat the buzzer.",
    inspectorTitle: "NBA Player Catalog"
  }
};

const clientSport = typeof import.meta !== "undefined" && import.meta.env?.VITE_SPORT === "nba" ? "nba" : "nfl";
export const ACTIVE_SPORT_ID: SportId = clientSport;
export const ACTIVE_SPORT = SPORTS[ACTIVE_SPORT_ID];
export const IS_NBA = ACTIVE_SPORT_ID === "nba";

export function formatActiveTeamLabel(teamId: TeamId) {
  const team = ACTIVE_SPORT.teams[teamId];
  return team ? `${team.city} ${team.name}` : teamId;
}
