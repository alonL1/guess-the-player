export type Difficulty = "easy" | "medium" | "hard" | "impossible";

export type GameMode = "kahoot" | "sudden_death";

export type RoomStatus =
  | "lobby"
  | "countdown"
  | "round_active"
  | "round_reveal"
  | "round_leaderboard"
  | "finished";

export type TeamId =
  | "ARI"
  | "ATL"
  | "BAL"
  | "BUF"
  | "CAR"
  | "CHI"
  | "CIN"
  | "CLE"
  | "DAL"
  | "DEN"
  | "DET"
  | "GB"
  | "HOU"
  | "IND"
  | "JAX"
  | "KC"
  | "LAC"
  | "LAR"
  | "LV"
  | "MIA"
  | "MIN"
  | "NE"
  | "NO"
  | "NYG"
  | "NYJ"
  | "PHI"
  | "PIT"
  | "SEA"
  | "SF"
  | "TB"
  | "TEN"
  | "WAS";

export interface TeamStint {
  teamId: TeamId;
  startYear: number;
  endYear: number | null;
}

export interface PlayerCatalogEntry {
  id: string;
  fullName: string;
  normalizedName: string;
  difficulty: Difficulty;
  headshotUrl: string;
  teamStints: TeamStint[];
  uniqueTeamCount: number;
}

export interface RoomSettings {
  roundCount: number;
  timePerRoundSeconds: number | null;
  difficulty: Difficulty[];
  mode: GameMode;
  showYears: boolean;
  maxPlayers: number;
  isPublic: boolean;
}

export interface RoomPlayer {
  participantId: string;
  sessionId: string;
  nickname: string;
  score: number;
  connected: boolean;
  isHost: boolean;
  joinedAt: string;
  answeredCorrectly: boolean;
  wrongGuessCount: number;
  roundScore: number | null;
}

export interface RoundResult {
  player: PlayerCatalogEntry;
  roundScores: Record<string, number>;
  correctOrder: string[];
  endedBecause: "timer" | "all_correct" | "manual" | "first_correct";
}

export interface RoundState {
  roundNumber: number;
  totalRounds: number;
  countdownEndsAt: string | null;
  startedAt: string | null;
  endsAt: string | null;
  teamStints: TeamStint[];
  reveal: RoundResult | null;
}

export interface RoomSnapshot {
  roomCode: string;
  status: RoomStatus;
  settings: RoomSettings;
  inviteUrl: string;
  players: RoomPlayer[];
  round: RoundState | null;
  canStart: boolean;
  roundsPlayed: number;
}

export interface PlayerSearchResult {
  id: string;
  fullName: string;
}
