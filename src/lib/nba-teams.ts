import type { TeamId } from "@/lib/types";

export type TeamDefinition = {
  name: string;
  city: string;
  abbreviation: TeamId;
  primary: string;
  secondary: string;
  logoUrl: string;
};

function logo(abbreviation: string) {
  return `https://a.espncdn.com/i/teamlogos/nba/500/${abbreviation}.png`;
}

export const NBA_TEAMS: Record<string, TeamDefinition> = {
  ATL: { name: "Hawks", city: "Atlanta", abbreviation: "ATL", primary: "#E03A3E", secondary: "#C1D32F", logoUrl: logo("atl") },
  BOS: { name: "Celtics", city: "Boston", abbreviation: "BOS", primary: "#007A33", secondary: "#BA9653", logoUrl: logo("bos") },
  BKN: { name: "Nets", city: "Brooklyn", abbreviation: "BKN", primary: "#000000", secondary: "#FFFFFF", logoUrl: logo("bkn") },
  CHA: { name: "Hornets", city: "Charlotte", abbreviation: "CHA", primary: "#1D1160", secondary: "#00788C", logoUrl: logo("cha") },
  CHI: { name: "Bulls", city: "Chicago", abbreviation: "CHI", primary: "#CE1141", secondary: "#000000", logoUrl: logo("chi") },
  CLE: { name: "Cavaliers", city: "Cleveland", abbreviation: "CLE", primary: "#860038", secondary: "#FDBB30", logoUrl: logo("cle") },
  DAL: { name: "Mavericks", city: "Dallas", abbreviation: "DAL", primary: "#00538C", secondary: "#B8C4CA", logoUrl: logo("dal") },
  DEN: { name: "Nuggets", city: "Denver", abbreviation: "DEN", primary: "#0E2240", secondary: "#FEC524", logoUrl: logo("den") },
  DET: { name: "Pistons", city: "Detroit", abbreviation: "DET", primary: "#C8102E", secondary: "#1D42BA", logoUrl: logo("det") },
  GSW: { name: "Warriors", city: "Golden State", abbreviation: "GSW", primary: "#1D428A", secondary: "#FFC72C", logoUrl: logo("gs") },
  HOU: { name: "Rockets", city: "Houston", abbreviation: "HOU", primary: "#CE1141", secondary: "#000000", logoUrl: logo("hou") },
  IND: { name: "Pacers", city: "Indiana", abbreviation: "IND", primary: "#002D62", secondary: "#FDBB30", logoUrl: logo("ind") },
  LAC: { name: "Clippers", city: "Los Angeles", abbreviation: "LAC", primary: "#C8102E", secondary: "#1D428A", logoUrl: logo("lac") },
  LAL: { name: "Lakers", city: "Los Angeles", abbreviation: "LAL", primary: "#552583", secondary: "#FDB927", logoUrl: logo("lal") },
  MEM: { name: "Grizzlies", city: "Memphis", abbreviation: "MEM", primary: "#5D76A9", secondary: "#12173F", logoUrl: logo("mem") },
  MIA: { name: "Heat", city: "Miami", abbreviation: "MIA", primary: "#98002E", secondary: "#F9A01B", logoUrl: logo("mia") },
  MIL: { name: "Bucks", city: "Milwaukee", abbreviation: "MIL", primary: "#00471B", secondary: "#EEE1C6", logoUrl: logo("mil") },
  MIN: { name: "Timberwolves", city: "Minnesota", abbreviation: "MIN", primary: "#0C2340", secondary: "#78BE20", logoUrl: logo("min") },
  NOP: { name: "Pelicans", city: "New Orleans", abbreviation: "NOP", primary: "#0C2340", secondary: "#C8102E", logoUrl: logo("no") },
  NYK: { name: "Knicks", city: "New York", abbreviation: "NYK", primary: "#006BB6", secondary: "#F58426", logoUrl: logo("ny") },
  OKC: { name: "Thunder", city: "Oklahoma City", abbreviation: "OKC", primary: "#007AC1", secondary: "#EF3B24", logoUrl: logo("okc") },
  ORL: { name: "Magic", city: "Orlando", abbreviation: "ORL", primary: "#0077C0", secondary: "#C4CED4", logoUrl: logo("orl") },
  PHI: { name: "76ers", city: "Philadelphia", abbreviation: "PHI", primary: "#006BB6", secondary: "#ED174C", logoUrl: logo("phi") },
  PHX: { name: "Suns", city: "Phoenix", abbreviation: "PHX", primary: "#1D1160", secondary: "#E56020", logoUrl: logo("phx") },
  POR: { name: "Trail Blazers", city: "Portland", abbreviation: "POR", primary: "#E03A3E", secondary: "#000000", logoUrl: logo("por") },
  SAC: { name: "Kings", city: "Sacramento", abbreviation: "SAC", primary: "#5A2D81", secondary: "#63727A", logoUrl: logo("sac") },
  SAS: { name: "Spurs", city: "San Antonio", abbreviation: "SAS", primary: "#000000", secondary: "#C4CED4", logoUrl: logo("sa") },
  TOR: { name: "Raptors", city: "Toronto", abbreviation: "TOR", primary: "#CE1141", secondary: "#000000", logoUrl: logo("tor") },
  UTA: { name: "Jazz", city: "Utah", abbreviation: "UTA", primary: "#002B5C", secondary: "#F9A01B", logoUrl: logo("utah") },
  WAS: { name: "Wizards", city: "Washington", abbreviation: "WAS", primary: "#002B5C", secondary: "#E31837", logoUrl: logo("wsh") }
};
