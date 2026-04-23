import type { TeamId } from "@/lib/types";

export const NFL_TEAMS: Record<
  TeamId,
  {
    name: string;
    city: string;
    abbreviation: TeamId;
    primary: string;
    secondary: string;
  }
> = {
  ARI: { name: "Cardinals", city: "Arizona", abbreviation: "ARI", primary: "#97233f", secondary: "#ffb612" },
  ATL: { name: "Falcons", city: "Atlanta", abbreviation: "ATL", primary: "#a71930", secondary: "#000000" },
  BAL: { name: "Ravens", city: "Baltimore", abbreviation: "BAL", primary: "#241773", secondary: "#9e7c0c" },
  BUF: { name: "Bills", city: "Buffalo", abbreviation: "BUF", primary: "#00338d", secondary: "#c60c30" },
  CAR: { name: "Panthers", city: "Carolina", abbreviation: "CAR", primary: "#0085ca", secondary: "#101820" },
  CHI: { name: "Bears", city: "Chicago", abbreviation: "CHI", primary: "#0b162a", secondary: "#c83803" },
  CIN: { name: "Bengals", city: "Cincinnati", abbreviation: "CIN", primary: "#fb4f14", secondary: "#000000" },
  CLE: { name: "Browns", city: "Cleveland", abbreviation: "CLE", primary: "#311d00", secondary: "#ff3c00" },
  DAL: { name: "Cowboys", city: "Dallas", abbreviation: "DAL", primary: "#003594", secondary: "#869397" },
  DEN: { name: "Broncos", city: "Denver", abbreviation: "DEN", primary: "#fb4f14", secondary: "#002244" },
  DET: { name: "Lions", city: "Detroit", abbreviation: "DET", primary: "#0076b6", secondary: "#b0b7bc" },
  GB: { name: "Packers", city: "Green Bay", abbreviation: "GB", primary: "#203731", secondary: "#ffb612" },
  HOU: { name: "Texans", city: "Houston", abbreviation: "HOU", primary: "#03202f", secondary: "#a71930" },
  IND: { name: "Colts", city: "Indianapolis", abbreviation: "IND", primary: "#002c5f", secondary: "#a2aaad" },
  JAX: { name: "Jaguars", city: "Jacksonville", abbreviation: "JAX", primary: "#006778", secondary: "#9f792c" },
  KC: { name: "Chiefs", city: "Kansas City", abbreviation: "KC", primary: "#e31837", secondary: "#ffb81c" },
  LAC: { name: "Chargers", city: "Los Angeles", abbreviation: "LAC", primary: "#0080c6", secondary: "#ffc20e" },
  LAR: { name: "Rams", city: "Los Angeles", abbreviation: "LAR", primary: "#003594", secondary: "#ffa300" },
  LV: { name: "Raiders", city: "Las Vegas", abbreviation: "LV", primary: "#000000", secondary: "#a5acaf" },
  MIA: { name: "Dolphins", city: "Miami", abbreviation: "MIA", primary: "#008e97", secondary: "#fc4c02" },
  MIN: { name: "Vikings", city: "Minnesota", abbreviation: "MIN", primary: "#4f2683", secondary: "#ffc62f" },
  NE: { name: "Patriots", city: "New England", abbreviation: "NE", primary: "#002244", secondary: "#c60c30" },
  NO: { name: "Saints", city: "New Orleans", abbreviation: "NO", primary: "#d3bc8d", secondary: "#101820" },
  NYG: { name: "Giants", city: "New York", abbreviation: "NYG", primary: "#0b2265", secondary: "#a71930" },
  NYJ: { name: "Jets", city: "New York", abbreviation: "NYJ", primary: "#125740", secondary: "#ffffff" },
  PHI: { name: "Eagles", city: "Philadelphia", abbreviation: "PHI", primary: "#004c54", secondary: "#a5acaf" },
  PIT: { name: "Steelers", city: "Pittsburgh", abbreviation: "PIT", primary: "#101820", secondary: "#ffb612" },
  SEA: { name: "Seahawks", city: "Seattle", abbreviation: "SEA", primary: "#002244", secondary: "#69be28" },
  SF: { name: "49ers", city: "San Francisco", abbreviation: "SF", primary: "#aa0000", secondary: "#b3995d" },
  TB: { name: "Buccaneers", city: "Tampa Bay", abbreviation: "TB", primary: "#d50a0a", secondary: "#34302b" },
  TEN: { name: "Titans", city: "Tennessee", abbreviation: "TEN", primary: "#0c2340", secondary: "#4b92db" },
  WAS: { name: "Commanders", city: "Washington", abbreviation: "WAS", primary: "#5a1414", secondary: "#ffb612" }
};

export function formatTeamLabel(teamId: TeamId) {
  const team = NFL_TEAMS[teamId];
  return `${team.city} ${team.name}`;
}
