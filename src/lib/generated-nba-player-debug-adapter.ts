import { GENERATED_NBA_PLAYER_DEBUG, NBA_DIFFICULTY_THRESHOLDS } from "@/lib/generated-nba-player-debug";

export type PlayerDebug = {
  familiarity: number;
  peak: number;
  careerProminence: number;
  avg: number;
  seasonCount: number;
  uniqueTeamCount: number;
  careerStartYear: number;
  lastSeason: number;
  yearsAgo: number;
  positionFactor: number;
  preStatSeasons: number;
  core: number;
  quality: number;
  longevity: number;
  teamBonus: number;
  recency: number;
  productionGate: number;
  context: number;
  recentDefensiveImpact: number;
  defenseDiscount: number;
  preStatBonus: number;
  longevityFallback: number;
};

export const PLAYER_DEBUG: Record<string, PlayerDebug> = Object.fromEntries(
  GENERATED_NBA_PLAYER_DEBUG.map((entry) => {
    const breakdown = entry.breakdown;
    return [entry.id, {
      familiarity: entry.familiarity,
      peak: breakdown.peak,
      careerProminence: breakdown.production,
      avg: breakdown.impact,
      seasonCount: entry.seasonCount,
      uniqueTeamCount: entry.uniqueTeamCount,
      careerStartYear: entry.careerStartYear,
      lastSeason: entry.careerEndYear,
      yearsAgo: entry.yearsAgo,
      positionFactor: 1,
      preStatSeasons: 0,
      core: breakdown.peak + breakdown.production + breakdown.impact,
      quality: breakdown.peak + breakdown.production + breakdown.impact,
      longevity: breakdown.longevity,
      teamBonus: breakdown.teams,
      recency: breakdown.recency,
      productionGate: 1,
      context: breakdown.longevity + breakdown.teams + breakdown.recency,
      recentDefensiveImpact: 0,
      defenseDiscount: 0,
      preStatBonus: 0,
      longevityFallback: 0
    }];
  })
);

const values = { ...NBA_DIFFICULTY_THRESHOLDS };
export const FAMILIARITY_THRESHOLDS = { offense: values, defense: values, specialTeams: values } as const;
