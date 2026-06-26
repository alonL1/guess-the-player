import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const outputPath = path.join(repoRoot, "src/lib/generated-player-catalog.ts");
const debugOutputPath = path.join(repoRoot, "src/lib/generated-player-debug.ts");

// Opt-in on-disk cache for fetched CSVs (set CATALOG_CACHE=1). Speeds up local
// threshold recalibration; never used on a clean deploy, so prod stays fresh.
const CACHE_ENABLED = process.env.CATALOG_CACHE === "1";
const CACHE_DIR = path.join(os.tmpdir(), "npg-catalog-cache");

const START_SEASON = 1970;
const WEEKLY_ROSTER_START_SEASON = 2011;
const CURRENT_YEAR = new Date().getUTCFullYear();
const OFFENSIVE_POSITIONS = new Set(["QB", "RB", "FB", "WR", "TE"]);
const DEFENSIVE_POSITIONS = new Set(["DL", "DE", "DT", "NT", "EDGE", "LB", "ILB", "OLB", "MLB", "CB", "DB", "S", "FS", "SS"]);
const SPECIAL_TEAMS_POSITIONS = new Set(["K", "P"]);
const POSITIONS = new Set([...OFFENSIVE_POSITIONS, ...DEFENSIVE_POSITIONS, ...SPECIAL_TEAMS_POSITIONS]);
const RETIRED_STATUS_CODES = new Set(["RET"]);
const FREE_AGENT_STATUS_CODES = new Set(["UFA", "RFA", "U01", "U02"]);

// ---- Difficulty model (single continuous "familiarity" score + thresholds) ----
// How recognizable each position is, blending stat-scale normalization (QBs put
// up huge counting numbers) with guessability (skill players > linemen/ST).
// Front seven get a lower factor than the secondary: even after halving the
// defensive stat weights, edge/interior rushers (sacks) still over-score, and
// they're a bit less name-familiar to casual fans than ball-hawking DBs.
const DEFENSIVE_BACKS = new Set(["CB", "DB", "S", "FS", "SS"]);
const OFF_BALL_LINEBACKERS = new Set(["ILB", "MLB"]);
function positionFactor(position) {
  if (position === "QB") return 0.72;
  if (position === "WR") return 1.0;
  if (position === "RB") return 0.88;
  if (position === "TE") return 0.95;
  if (position === "FB") return 0.85;
  if (position === "K") return 0.35;
  if (position === "P") return 0.4;
  if (DEFENSIVE_BACKS.has(position)) return 0.68;
  if (OFF_BALL_LINEBACKERS.has(position)) return 0.8;
  if (DEFENSIVE_POSITIONS.has(position)) return 0.58; // front seven
  return 0.85;
}

// First season with nflverse player stat files; earlier seasons score zero.
const STAT_ERA_START = 1999;

// Familiarity thresholds (tuned against the generated distribution). Offense
// and defense use separate cut lines because their stat distributions are very
// different; special teams stays intentionally stricter/rarer.
const OFFENSE_THRESHOLDS = {
  easy: 125,
  medium: 78,
  hard: 42.5,
  impossible: 7
};
const DEFENSE_THRESHOLDS = {
  easy: 118,
  medium: 82,
  hard: 66,
  impossible: 20
};
const SPECIAL_TEAMS_THRESHOLDS = {
  easy: 105,
  medium: 74,
  hard: 50,
  impossible: 5
};
// Flat familiarity discount for defensive players. Defense is a notch less
// name-familiar than offense, and there are structurally more eligible defenders
// (the offensive line is excluded). A FLAT shift (not a multiplier) trims the
// obscure defensive tail below the floor — balancing offense vs defense — while
// leaving the stars correctly near the top.
const DEFENSE_FAMILIARITY_DISCOUNT = 12;
const RECENT_DEFENSIVE_IMPACT_BONUS = 13;
const RECENT_DEFENSIVE_BACK_IMPACT_CORE_MIN = 49;
const RECENT_LINEBACKER_IMPACT_CORE_MIN = 55;
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
  ["WFT", "WAS"],
  ["PHX", "ARI"],
  ["LVR", "LV"]
]);
const UNRECOGNIZED_TEAM_IDS = new Set();

// Historical logos ESPN's CDN actually hosts (verified). Older eras without a
// hosted logo fall back to the franchise's current logo in the UI.
const STL_RAMS_LOGO = "https://a.espncdn.com/i/teamlogos/nfl/500/stl.png";
const RAIDERS_SHIELD_LOGO = "https://a.espncdn.com/i/teamlogos/nfl/500/oak.png";
const SD_CHARGERS_LOGO = "https://a.espncdn.com/i/teamlogos/nfl/500/sd.png";

// Franchise eras for relocations/renames since 1970. Each entry's `end` is the
// last season (inclusive) of that era. The CURRENT identity is implicit (any
// season after the last listed `end`) and matches NFL_TEAMS, so current-era
// stints carry no overrides. Only franchises that changed city or name appear.
const FRANCHISE_ERAS = {
  IND: [{ end: 1983, city: "Baltimore", name: "Colts" }],
  ARI: [
    { end: 1987, city: "St. Louis", name: "Cardinals" },
    { end: 1993, city: "Phoenix", name: "Cardinals" }
  ],
  LAR: [
    { end: 1994, city: "Los Angeles", name: "Rams" },
    { end: 2015, city: "St. Louis", name: "Rams", logoUrl: STL_RAMS_LOGO }
  ],
  LV: [
    { end: 1981, city: "Oakland", name: "Raiders", logoUrl: RAIDERS_SHIELD_LOGO },
    { end: 1994, city: "Los Angeles", name: "Raiders", logoUrl: RAIDERS_SHIELD_LOGO },
    { end: 2019, city: "Oakland", name: "Raiders", logoUrl: RAIDERS_SHIELD_LOGO }
  ],
  LAC: [{ end: 2016, city: "San Diego", name: "Chargers", logoUrl: SD_CHARGERS_LOGO }],
  TEN: [
    { end: 1996, city: "Houston", name: "Oilers" },
    { end: 1998, city: "Tennessee", name: "Oilers" }
  ],
  WAS: [
    { end: 2019, city: "Washington", name: "Redskins" },
    { end: 2021, city: "Washington", name: "Football Team" }
  ],
  NE: [{ end: 1970, city: "Boston", name: "Patriots" }]
};

function resolveEra(teamId, season) {
  const eras = FRANCHISE_ERAS[teamId];
  if (!eras) return { key: teamId };
  for (let index = 0; index < eras.length; index += 1) {
    if (season <= eras[index].end) {
      const { city, name, logoUrl } = eras[index];
      return { key: `${teamId}:${index}`, city, name, logoUrl };
    }
  }
  return { key: teamId };
}

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
  if (CACHE_ENABLED) {
    const cachePath = path.join(CACHE_DIR, `${createHash("sha1").update(url).digest("hex")}.csv`);
    if (existsSync(cachePath)) {
      return parseCsv(await readFile(cachePath, "utf-8"));
    }
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`);
    }
    const text = await response.text();
    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(cachePath, text);
    return parseCsv(text);
  }
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

function rowDisplayName(row) {
  return row?.display_name || row?.full_name || row?.player_display_name;
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

function compactName(input) {
  return input
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function firstNameToken(input) {
  return compactName(String(input).split(/\s+/)[0] ?? "");
}

function namesMatch(left, right) {
  if (!left || !right) return true;
  return compactName(left) === compactName(right);
}

function masterIdentityNames(masterPlayer) {
  if (!masterPlayer) return [];
  return [
    rowDisplayName(masterPlayer),
    masterPlayer.football_name && masterPlayer.last_name ? `${masterPlayer.football_name} ${masterPlayer.last_name}` : "",
    masterPlayer.common_first_name && masterPlayer.last_name ? `${masterPlayer.common_first_name} ${masterPlayer.last_name}` : "",
    masterPlayer.short_name && masterPlayer.last_name ? `${masterPlayer.short_name} ${masterPlayer.last_name}` : ""
  ].filter(Boolean);
}

function masterFirstNames(masterPlayer) {
  if (!masterPlayer) return [];
  return [
    masterPlayer.common_first_name,
    masterPlayer.first_name,
    masterPlayer.football_name,
    rowDisplayName(masterPlayer)
  ]
    .filter(Boolean)
    .map(firstNameToken)
    .filter(Boolean);
}

function stableIdentifiersMatch(row, masterPlayer) {
  if (!masterPlayer) return false;
  const checks = [
    row.pfr_id && masterPlayer.pfr_id ? row.pfr_id === masterPlayer.pfr_id : null,
    row.espn_id && masterPlayer.espn_id ? row.espn_id === masterPlayer.espn_id : null
  ].filter((value) => value !== null);
  return checks.length > 0 && checks.every(Boolean);
}

function editDistance(left, right) {
  if (left === right) return 0;
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i++) {
    let diagonal = previous[0];
    previous[0] = i;
    for (let j = 1; j <= right.length; j++) {
      const above = previous[j];
      previous[j] = Math.min(
        previous[j] + 1,
        previous[j - 1] + 1,
        diagonal + (left[i - 1] === right[j - 1] ? 0 : 1)
      );
      diagonal = above;
    }
  }
  return previous[right.length];
}

function firstNamesCompatible(rowName, masterPlayer) {
  const rowFirst = firstNameToken(rowName);
  const masterNames = masterFirstNames(masterPlayer);
  if (!rowFirst || masterNames.length === 0) return false;
  if (masterNames.includes(rowFirst)) return true;
  return rowFirst.length >= 4 && masterNames.some((masterFirst) => masterFirst.length >= 4 && editDistance(rowFirst, masterFirst) <= 2);
}

function rowMatchesMasterIdentity(row, masterPlayer) {
  const rowName = rowDisplayName(row);
  if (!masterPlayer || !rowName) return true;
  if (masterIdentityNames(masterPlayer).some((masterName) => namesMatch(masterName, rowName))) return true;
  if (!stableIdentifiersMatch(row, masterPlayer)) return false;
  if (firstNamesCompatible(rowName, masterPlayer)) return true;
  return false;
}

function incrementCount(counts, value) {
  if (!value) return;
  counts.set(value, (counts.get(value) ?? 0) + 1);
}

function mostCommon(counts) {
  return [...counts.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0]?.[0];
}

function emptyStat() {
  return {
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
}

function addStatRow(target, row) {
  target.passingYards += toNumber(row.passing_yards);
  target.passingTds += toNumber(row.passing_tds);
  target.rushingYards += toNumber(row.rushing_yards);
  target.rushingTds += toNumber(row.rushing_tds);
  target.receivingYards += toNumber(row.receiving_yards);
  target.receivingTds += toNumber(row.receiving_tds);
  target.receptions += toNumber(row.receptions);
  target.defTackles +=
    toNumber(row.def_tackles) +
    toNumber(row.def_tackles_solo) +
    toNumber(row.def_tackles_with_assist) +
    toNumber(row.def_tackle_assists);
  target.defSacks += toNumber(row.def_sacks);
  target.defInterceptions += toNumber(row.def_interceptions);
  target.defPassesDefended += toNumber(row.def_pass_defended);
  target.defForcedFumbles += toNumber(row.def_forced_fumbles) + toNumber(row.def_fumbles_forced);
  target.defFumbleRecoveries += toNumber(row.def_fumble_recoveries) + toNumber(row.fumble_recovery_opp);
  target.defTds += toNumber(row.def_tds);
  target.defQbHits += toNumber(row.def_qb_hits);
  target.fgMade += toNumber(row.fg_made);
  target.fgMade50 += toNumber(row.fg_made_50_59) + toNumber(row.fg_made_60_);
  target.patMade += toNumber(row.pat_made);
  target.gwfgMade += toNumber(row.gwfg_made);
  target.puntReturnYards += toNumber(row.punt_return_yards);
  target.kickoffReturnYards += toNumber(row.kickoff_return_yards);
  target.specialTeamsTds += toNumber(row.special_teams_tds);
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

  // Defensive weights are roughly half of the previous pass — sack-heavy front
  // sevens were producing 2-3x the raw score of elite skill players. Sacks took
  // the biggest cut since they were the main inflator.
  const defense =
    stat.defTackles / 32 +
    stat.defSacks * 4 +
    stat.defInterceptions * 5 +
    stat.defPassesDefended * 1.5 +
    stat.defForcedFumbles * 2.5 +
    stat.defFumbleRecoveries * 2 +
    stat.defTds * 6 +
    stat.defQbHits * 0.8;

  const kicking = stat.fgMade * 2 + stat.fgMade50 * 1.5 + stat.patMade / 14 + stat.gwfgMade * 4;
  const returning = stat.puntReturnYards / 150 + stat.kickoffReturnYards / 220 + stat.specialTeamsTds * 8;

  return offense + defense + kicking + returning;
}

function getLastSeason(seasonTeams) {
  return Math.max(...seasonTeams.keys());
}

// Small recency additive (max 22). Kept low so it nudges recent players without
// guaranteeing they clear the impossible cutoff — a marginal current journeyman
// can still be impossible — and a recent scrub can't out-score a retired legend.
function getRecencyBoost(lastSeason, latestRosterSeason) {
  const yearsAgo = latestRosterSeason - lastSeason;
  if (yearsAgo <= 0) return 22;
  if (yearsAgo <= 1) return 19;
  if (yearsAgo <= 3) return 15;
  if (yearsAgo <= 6) return 11;
  if (yearsAgo <= 10) return 7;
  if (yearsAgo <= 15) return 4;
  if (yearsAgo <= 20) return 2;
  return 1;
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

// One continuous "familiarity" score. Higher = more recognizable = easier.
//
//   familiarity = positionFactor * core   (production)
//               + longevity + teams + recency   (small additive context)
//
// where `core` blends PEAK (best single season) with AVERAGE production per
// season. Both are low for "compilers" (long but mediocre), so longevity alone
// can no longer push a forgettable player into the easy/medium pools.
function computeFamiliarity({ peak, careerProminence, seasonCount, uniqueTeamCount, careerStartYear, lastSeason, latestRosterSeason, position }) {
  const avg = seasonCount > 0 ? careerProminence / seasonCount : 0;
  let core = peak * 0.7 + avg * 1.15;

  // Stat files start in 1999, so seasons before then score zero — which badly
  // undercounts 80s/90s greats (their prime is invisible). Add a durability
  // supplement for those unstat-ted seasons. It scales with how long they lasted
  // in that era, so genuine long careers get lifted without rescuing scrubs.
  const preStatSeasons = Math.max(0, Math.min(seasonCount, STAT_ERA_START - careerStartYear));
  const preStatBonus = preStatSeasons * 6;
  core += preStatBonus;

  // Still basically nothing (punters with no tracked volume can pick up tiny
  // return/kicking crumbs): fall back to a modest longevity proxy so real
  // multi-year specialists don't disappear just because punting volume is not
  // represented in the stat feed.
  let longevityFallback = 0;
  if (core < 1 && seasonCount >= 6) {
    longevityFallback = seasonCount * 4 + uniqueTeamCount * 3;
    core = longevityFallback;
  }

  const pf = positionFactor(position);
  const quality = pf * core;
  const longevity = Math.min(seasonCount, 15) * 1.2;
  const teamBonus = Math.min(uniqueTeamCount, 4) * 1.5;
  const recency = getRecencyBoost(lastSeason, latestRosterSeason);
  // Context bonuses only count to the extent the player actually produced. A
  // near-zero-production journeyman (mostly defensive role players / practice-
  // squad bodies who appeared on a few rosters) shouldn't qualify just for
  // existing recently — so the bonuses ramp in with production. This drops the
  // bonus-only scrubs through the score itself, balancing offense vs defense.
  const productionGate = Math.min(1, core / 30);
  const context = (longevity + teamBonus + recency) * productionGate;
  const defenseDiscount = DEFENSIVE_POSITIONS.has(position) ? DEFENSE_FAMILIARITY_DISCOUNT : 0;
  const yearsAgo = latestRosterSeason - lastSeason;
  const baseValue = quality + context - defenseDiscount;
  const canReceiveRecentDefensiveImpact =
    (DEFENSIVE_BACKS.has(position) && core >= RECENT_DEFENSIVE_BACK_IMPACT_CORE_MIN) ||
    ((position === "LB" || OFF_BALL_LINEBACKERS.has(position)) && core >= RECENT_LINEBACKER_IMPACT_CORE_MIN);
  // Defensive production can lag offensive name-recognition in short/current
  // careers. Use this only as a hard-cutoff rescue for productive recent
  // defenders who are otherwise sitting just below "hard"; already-ranked
  // defenders do not get inflated.
  const recentDefensiveImpact =
    canReceiveRecentDefensiveImpact &&
    yearsAgo <= 1 &&
    baseValue < DEFENSE_THRESHOLDS.hard &&
    baseValue >= DEFENSE_THRESHOLDS.hard - RECENT_DEFENSIVE_IMPACT_BONUS
      ? RECENT_DEFENSIVE_IMPACT_BONUS
      : 0;
  const value = baseValue + recentDefensiveImpact;

  return {
    value,
    avg,
    core,
    quality,
    longevity,
    teamBonus,
    recency,
    productionGate,
    context,
    recentDefensiveImpact,
    defenseDiscount,
    preStatSeasons,
    preStatBonus,
    longevityFallback,
    positionFactor: pf,
    yearsAgo
  };
}

function thresholdsForPosition(position) {
  if (OFFENSIVE_POSITIONS.has(position)) return OFFENSE_THRESHOLDS;
  if (DEFENSIVE_POSITIONS.has(position)) return DEFENSE_THRESHOLDS;
  return SPECIAL_TEAMS_THRESHOLDS;
}

function classifyByFamiliarity(familiarity, position) {
  const thresholds = thresholdsForPosition(position);
  if (familiarity >= thresholds.easy) return "easy";
  if (familiarity >= thresholds.medium) return "medium";
  if (familiarity >= thresholds.hard) return "hard";
  return "impossible";
}

function buildStints(seasonTeams, latestRosterSeason, careerStatus) {
  const ordered = [...seasonTeams.entries()]
    .sort(([leftYear], [rightYear]) => leftYear - rightYear)
    .flatMap(([season, teams]) => teams.map((teamId) => ({ season, teamId, era: resolveEra(teamId, season) })));

  const stints = [];
  for (const item of ordered) {
    const previous = stints.at(-1);
    // Break a stint when the franchise changes OR the era changes (relocation /
    // rename), so each card shows a single correct city + name + logo.
    if (
      previous &&
      previous.teamId === item.teamId &&
      previous.eraKey === item.era.key &&
      item.season <= previous.endYear + 1
    ) {
      previous.endYear = item.season;
    } else {
      stints.push({
        teamId: item.teamId,
        startYear: item.season,
        endYear: item.season,
        eraKey: item.era.key,
        city: item.era.city,
        name: item.era.name,
        logoUrl: item.era.logoUrl
      });
    }
  }

  return stints.map((stint, index) => {
    const out = {
      teamId: stint.teamId,
      startYear: stint.startYear,
      endYear:
        index === stints.length - 1 && stint.endYear >= latestRosterSeason && careerStatus === "signed"
          ? null
          : stint.endYear
    };
    // Only historical eras carry overrides; current-era stints stay bare.
    if (stint.city) out.city = stint.city;
    if (stint.name) out.name = stint.name;
    if (stint.logoUrl) out.logoUrl = stint.logoUrl;
    return out;
  });
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

  // Career totals AND best single-season prominence (peak). Peak lets us tell a
  // long mediocre "compiler" apart from a player who was genuinely great.
  const stats = new Map();
  const peakProminence = new Map();
  for (const rows of statRowsBySeason) {
    const seasonStats = new Map(); // key -> this one season's totals
    for (const row of rows) {
      const key = playerKey(row);
      if (!key) continue;
      if (!rowMatchesMasterIdentity(row, masterPlayers.get(key))) continue;
      const career = stats.get(key) ?? emptyStat();
      addStatRow(career, row);
      stats.set(key, career);
      const season = seasonStats.get(key) ?? emptyStat();
      addStatRow(season, row);
      seasonStats.set(key, season);
    }
    for (const [key, season] of seasonStats) {
      const p = prominenceFromStats(season);
      if (p > (peakProminence.get(key) ?? 0)) peakProminence.set(key, p);
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
      if (!rowMatchesMasterIdentity(row, masterPlayers.get(key))) continue;

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
      const fullName = rowDisplayName(row);
      const position = row.position;

      if (!key || !season || !teamId || !fullName || !POSITIONS.has(position)) continue;
      if (!rowMatchesMasterIdentity(row, masterPlayers.get(key))) continue;

      const current = players.get(key) ?? {
        key,
        fullName,
        headshotUrl: row.headshot_url || "",
        position,
        nameCounts: new Map(),
        positionCounts: new Map(),
        headshotCounts: new Map(),
        seasonTeams: new Map(),
        latestRosterSeason: 0,
        latestRosterRow: null
      };
      incrementCount(current.nameCounts, fullName);
      incrementCount(current.positionCounts, position);
      incrementCount(current.headshotCounts, row.headshot_url);
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
    const masterPlayer = masterPlayers.get(player.key);
    const resolvedName = rowDisplayName(masterPlayer) || mostCommon(player.nameCounts) || player.fullName;
    const resolvedPosition =
      masterPlayer?.position && POSITIONS.has(masterPlayer.position)
        ? masterPlayer.position
        : mostCommon(player.positionCounts) || player.position;
    const resolvedHeadshot = masterPlayer?.headshot || mostCommon(player.headshotCounts) || player.headshotUrl;
    const careerStatus = classifyCareerStatus(player, masterPlayer, latestRosterSeason);
    const teamStints = buildStints(player.seasonTeams, latestRosterSeason, careerStatus);
    const uniqueTeamCount = new Set(teamStints.map((stint) => stint.teamId)).size;
    const stat = stats.get(player.key);
    const seasonCount = player.seasonTeams.size;
    const lastSeason = getLastSeason(player.seasonTeams);
    const careerStartYear = Math.min(...player.seasonTeams.keys());
    const careerProminence = stat ? prominenceFromStats(stat) : 0;
    const peak = peakProminence.get(player.key) ?? 0;

    const familiarity = computeFamiliarity({
      peak,
      careerProminence,
      seasonCount,
      uniqueTeamCount,
      careerStartYear,
      lastSeason,
      latestRosterSeason,
      position: resolvedPosition
    });

    if (uniqueTeamCount < 2) continue;
    if (familiarity.value < thresholdsForPosition(resolvedPosition).impossible) continue;

    generated.push({
      fullName: resolvedName,
      position: resolvedPosition,
      difficulty: classifyByFamiliarity(familiarity.value, resolvedPosition),
      careerStatus,
      headshotUrl: resolvedHeadshot || undefined,
      teamStints,
      familiarity: Math.round(familiarity.value), // for sorting; stripped from catalog
      // Full breakdown — written to a SEPARATE debug file (not the catalog) for
      // the localhost-only inspector. Shows exactly how difficulty was reached.
      _dbg: {
        familiarity: Math.round(familiarity.value),
        peak: Math.round(peak),
        careerProminence: Math.round(careerProminence),
        avg: Math.round(familiarity.avg),
        seasonCount,
        uniqueTeamCount,
        careerStartYear,
        lastSeason,
        yearsAgo: familiarity.yearsAgo,
        positionFactor: familiarity.positionFactor,
        preStatSeasons: familiarity.preStatSeasons,
        core: Math.round(familiarity.core),
        quality: Math.round(familiarity.quality),
        longevity: Math.round(familiarity.longevity),
        teamBonus: Math.round(familiarity.teamBonus),
        recency: Math.round(familiarity.recency),
        productionGate: Math.round(familiarity.productionGate * 100) / 100,
        context: Math.round(familiarity.context),
        recentDefensiveImpact: Math.round(familiarity.recentDefensiveImpact),
        defenseDiscount: Math.round(familiarity.defenseDiscount),
        preStatBonus: Math.round(familiarity.preStatBonus),
        longevityFallback: Math.round(familiarity.longevityFallback)
      }
    });
  }

  const deduped = dedupeIds(
    generated.sort((left, right) => right.familiarity - left.familiarity || left.fullName.localeCompare(right.fullName))
  );

  if (UNRECOGNIZED_TEAM_IDS.size > 0) {
    throw new Error(`Unrecognized roster team IDs: ${[...UNRECOGNIZED_TEAM_IDS].sort().join(", ")}`);
  }
  if (deduped.length < 50) {
    throw new Error(`Generated catalog is too small (${deduped.length} players)`);
  }

  // Keep `familiarity` on each catalog entry (used at runtime for the "sickest
  // pull" ranking); only the verbose `_dbg` breakdown is stripped.
  const sorted = deduped.map(({ _dbg: _debug, ...player }) => player);

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

  // Separate debug file (keyed by player id) for the localhost-only catalog
  // inspector. Dynamically imported, so it never bloats the shipped game bundle.
  const debugById = {};
  for (const p of deduped) debugById[p.id] = p._dbg;
  const debugBody = `// Generated by scripts/generate-player-catalog.mjs — difficulty breakdown per player.
// Do not edit by hand. Loaded only by the localhost catalog inspector.

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

export const FAMILIARITY_THRESHOLDS = {
  offense: ${JSON.stringify(OFFENSE_THRESHOLDS)},
  defense: ${JSON.stringify(DEFENSE_THRESHOLDS)},
  specialTeams: ${JSON.stringify(SPECIAL_TEAMS_THRESHOLDS)}
} as const;

export const PLAYER_DEBUG: Record<string, PlayerDebug> = ${JSON.stringify(debugById)};
`;
  await writeFile(debugOutputPath, `${debugBody}\n`);
  console.log(`Generated difficulty debug for ${deduped.length} players at ${path.relative(repoRoot, debugOutputPath)}`);
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
