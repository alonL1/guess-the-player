import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const outputPath = path.join(repoRoot, "src/lib/generated-player-catalog.ts");

const START_SEASON = 1970;
const WEEKLY_ROSTER_START_SEASON = 2011;
const CURRENT_YEAR = new Date().getUTCFullYear();
const OFFENSIVE_POSITIONS = new Set(["QB", "RB", "FB", "WR", "TE"]);
const DEFENSIVE_POSITIONS = new Set(["DL", "DE", "DT", "NT", "EDGE", "LB", "ILB", "OLB", "MLB", "CB", "DB", "S", "FS", "SS"]);
const SPECIAL_TEAMS_POSITIONS = new Set(["K", "P"]);
const POSITIONS = new Set([...OFFENSIVE_POSITIONS, ...DEFENSIVE_POSITIONS, ...SPECIAL_TEAMS_POSITIONS]);
const RETIRED_STATUS_CODES = new Set(["RET"]);
const FREE_AGENT_STATUS_CODES = new Set(["UFA", "RFA", "U01", "U02"]);
const VALID_TEAM_IDS = new Set([
  "ARI",
  "ATL",
  "BAL",
  "BUF",
  "CAR",
  "CHI",
  "CIN",
  "CLE",
  "DAL",
  "DEN",
  "DET",
  "GB",
  "HOU",
  "IND",
  "JAX",
  "KC",
  "LAC",
  "LAR",
  "LV",
  "MIA",
  "MIN",
  "NE",
  "NO",
  "NYG",
  "NYJ",
  "PHI",
  "PIT",
  "SEA",
  "SF",
  "TB",
  "TEN",
  "WAS"
]);

const TEAM_ALIASES = new Map([
  ["AZ", "ARI"],
  ["ARZ", "ARI"],
  ["BLT", "BAL"],
  ["BOS", "NE"],
  ["CLV", "CLE"],
  ["HST", "HOU"],
  ["JAC", "JAX"],
  ["LA", "LAR"],
  ["PHO", "ARI"],
  ["RAI", "LV"],
  ["RAM", "LAR"],
  ["SL", "LAR"],
  ["STL", "LAR"],
  ["SD", "LAC"],
  ["OAK", "LV"],
  ["WSH", "WAS"],
  ["WFT", "WAS"]
]);
const UNRECOGNIZED_TEAM_IDS = new Set();

function normalizeTeam(team, season) {
  if (team === "BAL" && season <= 1983) return "IND";
  if (team === "HOU" && season <= 1996) return "TEN";
  if (team === "STL" && season <= 1987) return "ARI";
  const normalized = TEAM_ALIASES.get(team) ?? team;
  if (VALID_TEAM_IDS.has(normalized)) return normalized;
  if (team) UNRECOGNIZED_TEAM_IDS.add(team);
  return null;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (quoted) {
      if (char === '"' && next === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (char !== "\r") {
      cell += char;
    }
  }

  if (cell || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  const [headers, ...dataRows] = rows;
  return dataRows
    .filter((dataRow) => dataRow.length > 1)
    .map((dataRow) => Object.fromEntries(headers.map((header, index) => [header, dataRow[index] ?? ""])));
}

async function fetchCsv(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  return parseCsv(await response.text());
}

async function fetchSeasonRows(kind, season) {
  const url =
    kind === "rosters"
      ? `https://github.com/nflverse/nflverse-data/releases/download/rosters/roster_${season}.csv`
      : kind === "weekly rosters"
        ? `https://github.com/nflverse/nflverse-data/releases/download/weekly_rosters/roster_weekly_${season}.csv`
        : `https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_reg_${season}.csv`;

  try {
    return await fetchCsv(url);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`Skipping ${kind} ${season}: ${message}`);
    return [];
  }
}

async function fetchPlayerRows() {
  try {
    return await fetchCsv("https://github.com/nflverse/nflverse-data/releases/download/players/players.csv");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`Skipping master player statuses: ${message}`);
    return [];
  }
}

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function playerKey(row) {
  return row.gsis_id || row.player_id || row.pfr_id || row.espn_id || row.full_name || row.player_display_name;
}

function createSlug(input) {
  return input
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\s+/g, "-");
}

function prominenceFromStats(stat) {
  const offense =
    stat.passingYards / 350 +
    stat.passingTds * 2.5 +
    stat.rushingYards / 120 +
    stat.rushingTds * 4 +
    stat.receivingYards / 120 +
    stat.receivingTds * 4 +
    stat.receptions / 12;

  const defense =
    stat.defTackles / 12 +
    stat.defSacks * 8 +
    stat.defInterceptions * 10 +
    stat.defPassesDefended * 2.5 +
    stat.defForcedFumbles * 5 +
    stat.defFumbleRecoveries * 4 +
    stat.defTds * 12 +
    stat.defQbHits * 1.5;

  const kicking = stat.fgMade * 4 + stat.fgMade50 * 3 + stat.patMade / 8 + stat.gwfgMade * 8;
  const returning = stat.puntReturnYards / 150 + stat.kickoffReturnYards / 220 + stat.specialTeamsTds * 8;

  return offense + defense + kicking + returning;
}

function getLastSeason(seasonTeams) {
  return Math.max(...seasonTeams.keys());
}

function getRecencyBoost(lastSeason, latestRosterSeason) {
  const yearsAgo = latestRosterSeason - lastSeason;
  if (yearsAgo <= 0) return 95;
  if (yearsAgo <= 1) return 80;
  if (yearsAgo <= 3) return 55;
  if (yearsAgo <= 6) return 30;
  if (yearsAgo <= 10) return 10;
  return 0;
}

function hasStatusCode(row, codes) {
  return [row?.status, row?.ngs_status, row?.ngs_status_short_description, row?.status_description_abbr]
    .filter(Boolean)
    .some((value) => {
      const normalized = String(value).toUpperCase();
      return codes.has(normalized) || [...codes].some((code) => normalized.includes(code));
    });
}

function classifyCareerStatus(player, masterPlayer, latestRosterSeason) {
  if (hasStatusCode(masterPlayer, RETIRED_STATUS_CODES) || hasStatusCode(player.latestRosterRow, RETIRED_STATUS_CODES)) {
    return "retired";
  }
  if (
    player.latestRosterSeason >= latestRosterSeason - 1 &&
    (hasStatusCode(masterPlayer, FREE_AGENT_STATUS_CODES) || hasStatusCode(player.latestRosterRow, FREE_AGENT_STATUS_CODES))
  ) {
    return "free_agent";
  }
  if (player.latestRosterSeason >= latestRosterSeason) {
    return "signed";
  }
  if (player.latestRosterSeason >= latestRosterSeason - 1 && masterPlayer) {
    return "free_agent";
  }
  return "retired";
}

function isDefensivePosition(position) {
  return DEFENSIVE_POSITIONS.has(position);
}

function isOffensivePosition(position) {
  return OFFENSIVE_POSITIONS.has(position);
}

function isSpecialTeamsPosition(position) {
  return SPECIAL_TEAMS_POSITIONS.has(position);
}

function increaseDifficulty(difficulty) {
  if (difficulty === "easy") return "medium";
  if (difficulty === "medium") return "hard";
  if (difficulty === "hard") return "impossible";
  return "impossible";
}

function classifyKickerDifficulty({ prominence, seasonCount, uniqueTeamCount, lastSeason, latestRosterSeason }) {
  const yearsAgo = latestRosterSeason - lastSeason;

  if (
    prominence >= 1700 ||
    (prominence >= 1600 && yearsAgo <= 6)
  ) {
    return "medium";
  }

  if (
    prominence >= 750 ||
    (prominence >= 450 && yearsAgo <= 6) ||
    seasonCount >= 9 ||
    uniqueTeamCount >= 5
  ) {
    return "hard";
  }

  return "impossible";
}

function classifyDifficulty({ prominence, seasonCount, uniqueTeamCount, lastSeason, latestRosterSeason, position, usedLongevityFallback }) {
  if (position === "K") {
    return classifyKickerDifficulty({ prominence, seasonCount, uniqueTeamCount, lastSeason, latestRosterSeason });
  }

  const yearsAgo = latestRosterSeason - lastSeason;
  const offensivePlayer = isOffensivePosition(position);
  const defensivePlayer = isDefensivePosition(position);
  const specialTeamsPlayer = isSpecialTeamsPosition(position);
  const defensivePenalty = defensivePlayer ? 35 : 0;
  const specialTeamsPenalty = specialTeamsPlayer ? 70 : 0;
  const positionAdjustedProminence = position === "QB" ? prominence * 0.45 : prominence;
  const adjustedProminence = defensivePlayer ? positionAdjustedProminence * 0.86 : positionAdjustedProminence;
  const familiarity =
    adjustedProminence +
    getRecencyBoost(lastSeason, latestRosterSeason) +
    Math.min(seasonCount, 10) * 3 +
    Math.min(uniqueTeamCount, 5) * 4 -
    defensivePenalty -
    specialTeamsPenalty;

  let difficulty;
  if (
    (position === "QB" && adjustedProminence >= 700 && seasonCount >= 10) ||
    (adjustedProminence >= 900 && yearsAgo <= 10) ||
    (adjustedProminence >= 450 && yearsAgo <= 6) ||
    (adjustedProminence >= 600 && yearsAgo <= 10 && familiarity >= 650)
  ) {
    difficulty = "easy";
  } else if (
    adjustedProminence >= 250 ||
    (adjustedProminence >= 105 && yearsAgo <= 6) ||
    (adjustedProminence >= 145 && yearsAgo <= 10) ||
    (adjustedProminence >= 125 && familiarity >= 220) ||
    (usedLongevityFallback && offensivePlayer && seasonCount >= 10 && uniqueTeamCount >= 2)
  ) {
    difficulty = "medium";
  } else if (
    adjustedProminence >= 35 ||
    (adjustedProminence >= 18 && yearsAgo <= 6) ||
    uniqueTeamCount >= 4 ||
    seasonCount >= 7
  ) {
    difficulty = "hard";
  } else {
    difficulty = "impossible";
  }

  if (defensivePlayer) {
    difficulty = increaseDifficulty(difficulty);
  }
  if (specialTeamsPlayer) {
    difficulty = increaseDifficulty(difficulty);
  }
  if (yearsAgo > 10 && adjustedProminence < 180 && !(offensivePlayer && seasonCount >= 10)) {
    difficulty = increaseDifficulty(difficulty);
  }

  return difficulty;
}

function buildStints(seasonTeams, latestRosterSeason, careerStatus) {
  const ordered = [...seasonTeams.entries()]
    .sort(([leftYear], [rightYear]) => leftYear - rightYear)
    .flatMap(([season, teams]) => teams.map((teamId) => ({ season, teamId })));

  const stints = [];
  for (const item of ordered) {
    const previous = stints.at(-1);
    if (previous && previous.teamId === item.teamId && item.season <= previous.endYear + 1) {
      previous.endYear = item.season;
    } else {
      stints.push({ teamId: item.teamId, startYear: item.season, endYear: item.season });
    }
  }

  return stints.map((stint, index) => ({
    ...stint,
    endYear: index === stints.length - 1 && stint.endYear >= latestRosterSeason && careerStatus === "signed" ? null : stint.endYear
  }));
}

function dedupeIds(players) {
  const seen = new Map();
  return players.map((player) => {
    const base = createSlug(player.fullName);
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return {
      ...player,
      id: count === 0 ? base : `${base}-${count + 1}`
    };
  });
}

async function main() {
  const seasons = Array.from({ length: CURRENT_YEAR - START_SEASON + 1 }, (_, index) => START_SEASON + index);
  const [rosterRowsBySeason, statRowsBySeason, masterPlayerRows] = await Promise.all([
    Promise.all(seasons.map((season) => fetchSeasonRows("rosters", season))),
    Promise.all(seasons.map((season) => fetchSeasonRows("stats", season))),
    fetchPlayerRows()
  ]);
  const latestRosterSeason = rosterRowsBySeason.reduce((latest, rows, index) => {
    return rows.length > 0 ? seasons[index] : latest;
  }, START_SEASON);
  const masterPlayers = new Map(masterPlayerRows.map((row) => [playerKey(row), row]).filter(([key]) => key));

  const stats = new Map();
  for (const rows of statRowsBySeason) {
    for (const row of rows) {
      const key = playerKey(row);
      if (!key) continue;
      const current = stats.get(key) ?? {
        passingYards: 0,
        passingTds: 0,
        rushingYards: 0,
        rushingTds: 0,
        receivingYards: 0,
        receivingTds: 0,
        receptions: 0,
        defTackles: 0,
        defSacks: 0,
        defInterceptions: 0,
        defPassesDefended: 0,
        defForcedFumbles: 0,
        defFumbleRecoveries: 0,
        defTds: 0,
        defQbHits: 0,
        fgMade: 0,
        fgMade50: 0,
        patMade: 0,
        gwfgMade: 0,
        puntReturnYards: 0,
        kickoffReturnYards: 0,
        specialTeamsTds: 0
      };
      current.passingYards += toNumber(row.passing_yards);
      current.passingTds += toNumber(row.passing_tds);
      current.rushingYards += toNumber(row.rushing_yards);
      current.rushingTds += toNumber(row.rushing_tds);
      current.receivingYards += toNumber(row.receiving_yards);
      current.receivingTds += toNumber(row.receiving_tds);
      current.receptions += toNumber(row.receptions);
      current.defTackles +=
        toNumber(row.def_tackles) +
        toNumber(row.def_tackles_solo) +
        toNumber(row.def_tackles_with_assist) +
        toNumber(row.def_tackle_assists);
      current.defSacks += toNumber(row.def_sacks);
      current.defInterceptions += toNumber(row.def_interceptions);
      current.defPassesDefended += toNumber(row.def_pass_defended);
      current.defForcedFumbles += toNumber(row.def_forced_fumbles) + toNumber(row.def_fumbles_forced);
      current.defFumbleRecoveries += toNumber(row.def_fumble_recoveries) + toNumber(row.fumble_recovery_opp);
      current.defTds += toNumber(row.def_tds);
      current.defQbHits += toNumber(row.def_qb_hits);
      current.fgMade += toNumber(row.fg_made);
      current.fgMade50 += toNumber(row.fg_made_50_59) + toNumber(row.fg_made_60_);
      current.patMade += toNumber(row.pat_made);
      current.gwfgMade += toNumber(row.gwfg_made);
      current.puntReturnYards += toNumber(row.punt_return_yards);
      current.kickoffReturnYards += toNumber(row.kickoff_return_yards);
      current.specialTeamsTds += toNumber(row.special_teams_tds);
      stats.set(key, current);
    }
  }

  const statSeasonTeams = new Map();
  for (const season of seasons.filter((candidate) => candidate >= WEEKLY_ROSTER_START_SEASON && candidate <= latestRosterSeason)) {
    const rows = await fetchSeasonRows("weekly rosters", season);
    for (const row of rows.sort((left, right) => toNumber(left.week) - toNumber(right.week))) {
      const key = playerKey(row);
      const season = toNumber(row.season);
      const teamId = normalizeTeam(row.team, season);
      if (!key || !season || !teamId) continue;

      const playerSeasonTeams = statSeasonTeams.get(key) ?? new Map();
      const teams = playerSeasonTeams.get(season) ?? [];
      if (!teams.includes(teamId)) teams.push(teamId);
      playerSeasonTeams.set(season, teams);
      statSeasonTeams.set(key, playerSeasonTeams);
    }
  }

  const players = new Map();
  for (const rows of rosterRowsBySeason) {
    for (const row of rows) {
      const key = playerKey(row);
      const season = toNumber(row.season);
      const teamId = normalizeTeam(row.team, season);
      const fullName = row.full_name || row.player_display_name;
      const position = row.position;

      if (!key || !season || !teamId || !fullName || !POSITIONS.has(position)) continue;

      const current = players.get(key) ?? {
        key,
        fullName,
        headshotUrl: row.headshot_url || "",
        position,
        seasonTeams: new Map(),
        latestRosterSeason: 0,
        latestRosterRow: null
      };
      if (!current.headshotUrl && row.headshot_url) current.headshotUrl = row.headshot_url;
      if (season >= current.latestRosterSeason) {
        current.latestRosterSeason = season;
        current.latestRosterRow = row;
      }
      if (!current.seasonTeams.has(season)) {
        current.seasonTeams.set(season, [...(statSeasonTeams.get(key)?.get(season) ?? [])]);
      }
      const teams = current.seasonTeams.get(season);
      if (!teams.includes(teamId)) teams.push(teamId);
      players.set(key, current);
    }
  }

  const generated = [];
  for (const player of players.values()) {
    const careerStatus = classifyCareerStatus(player, masterPlayers.get(player.key), latestRosterSeason);
    const teamStints = buildStints(player.seasonTeams, latestRosterSeason, careerStatus);
    const uniqueTeamCount = new Set(teamStints.map((stint) => stint.teamId)).size;
    const stat = stats.get(player.key);
    const seasonCount = player.seasonTeams.size;
    const lastSeason = getLastSeason(player.seasonTeams);
    let prominence = stat ? prominenceFromStats(stat) : 0;
    let usedLongevityFallback = false;

    // nflverse's player stat files do not include punting volume, and pre-1999
    // stat files are unavailable. Use longevity as a conservative proxy so
    // multi-team punters and notable older players can still enter hard pools.
    if (player.position === "P") {
      prominence = Math.max(prominence, seasonCount * 8 + uniqueTeamCount * 6);
    } else if (!stat && seasonCount >= 6) {
      usedLongevityFallback = true;
      const seasonWeight = OFFENSIVE_POSITIONS.has(player.position) ? 16 : 10;
      const teamWeight = OFFENSIVE_POSITIONS.has(player.position) ? 14 : 8;
      prominence = seasonCount * seasonWeight + uniqueTeamCount * teamWeight;
    }

    if (uniqueTeamCount < 2) continue;
    if (prominence < 12) continue;

    generated.push({
      fullName: player.fullName,
      position: player.position,
      difficulty: classifyDifficulty({
        prominence,
        seasonCount,
        uniqueTeamCount,
        lastSeason,
        latestRosterSeason,
        position: player.position,
        usedLongevityFallback
      }),
      careerStatus,
      headshotUrl: player.headshotUrl || undefined,
      teamStints,
      prominence: Math.round(prominence)
    });
  }

  const sorted = dedupeIds(
    generated.sort((left, right) => right.prominence - left.prominence || left.fullName.localeCompare(right.fullName))
  ).map(({ prominence: _prominence, ...player }) => player);

  if (UNRECOGNIZED_TEAM_IDS.size > 0) {
    throw new Error(`Unrecognized roster team IDs: ${[...UNRECOGNIZED_TEAM_IDS].sort().join(", ")}`);
  }
  if (sorted.length < 50) {
    throw new Error(`Generated catalog is too small (${sorted.length} players)`);
  }

  const body = `// Generated by scripts/generate-player-catalog.mjs from nflverse roster and player-stat releases.
// Do not edit by hand.

import type { PlayerCatalogEntry } from "./types";

type GeneratedPlayer = Omit<PlayerCatalogEntry, "headshotUrl" | "normalizedName" | "uniqueTeamCount" | "careerStatus"> &
  Partial<Pick<PlayerCatalogEntry, "headshotUrl" | "normalizedName" | "uniqueTeamCount" | "careerStatus">>;

export const GENERATED_PLAYERS = ${JSON.stringify(sorted, null, 2)} as const satisfies readonly GeneratedPlayer[];
`;

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${body}\n`);
  console.log(`Generated ${sorted.length} NFL players at ${path.relative(repoRoot, outputPath)}`);
}

try {
  await main();
} catch (error) {
  try {
    await readFile(outputPath, "utf8");
    console.warn(`Catalog refresh failed; keeping existing ${path.relative(repoRoot, outputPath)}`);
    console.warn(error instanceof Error ? error.message : String(error));
  } catch {
    throw error;
  }
}
