import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const cacheDir = path.join(repoRoot, ".cache", "nba-catalog");
const outputPath = path.join(repoRoot, "src/lib/generated-nba-player-catalog.ts");
const debugOutputPath = path.join(repoRoot, "src/lib/generated-nba-player-debug.ts");
const scheduleOutputPath = path.join(repoRoot, "src/lib/nba-daily-challenge-schedule.ts");

// ESPN seasons are labeled by their ending year: 2026 is the 2025-26 season.
const CURRENT_SEASON_END = Number(process.env.NBA_CURRENT_SEASON_END ?? 2026);
const BOX_SCORE_START = 2002;
const DAILY_SEED = 20260812;
const DAILY_SCHEDULE_LENGTH = 1000;
const DAILY_EPOCH = Date.UTC(2026, 7, 12);

const RAPTOR_URL = "https://raw.githubusercontent.com/fivethirtyeight/nba-player-advanced-metrics/master/nba-data-historical.csv";
const PLAYER_BOX_URL = (season) =>
  `https://github.com/sportsdataverse/sportsdataverse-data/releases/download/espn_nba_player_boxscores/player_box_${season}.csv`;
const PLAYER_CORE_URL = (season) =>
  `https://github.com/sportsdataverse/sportsdataverse-data/releases/download/espn_nba_player_core/player_core_${season}.csv`;
const CURRENT_ROSTER_URL = (teamSlug) =>
  `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/${teamSlug}/roster`;

const TEAM_BY_ESPN_ID = new Map([
  ["1", "ATL"], ["2", "BOS"], ["17", "BKN"], ["30", "CHA"], ["4", "CHI"],
  ["5", "CLE"], ["6", "DAL"], ["7", "DEN"], ["8", "DET"], ["9", "GSW"],
  ["10", "HOU"], ["11", "IND"], ["12", "LAC"], ["13", "LAL"], ["29", "MEM"],
  ["14", "MIA"], ["15", "MIL"], ["16", "MIN"], ["3", "NOP"], ["18", "NYK"],
  ["25", "OKC"], ["19", "ORL"], ["20", "PHI"], ["21", "PHX"], ["22", "POR"],
  ["23", "SAC"], ["24", "SAS"], ["28", "TOR"], ["26", "UTA"], ["27", "WAS"]
]);

const TEAM_ALIASES = new Map([
  ["ATL", "ATL"], ["BOS", "BOS"], ["BRK", "BKN"], ["NJN", "BKN"],
  ["CHA", "CHA"], ["CHO", "CHA"], ["CHH", "NOP"], ["CHI", "CHI"],
  ["CLE", "CLE"], ["DAL", "DAL"], ["DEN", "DEN"], ["DET", "DET"],
  ["GSW", "GSW"], ["HOU", "HOU"], ["IND", "IND"], ["LAC", "LAC"],
  ["SDC", "LAC"], ["BUF", "LAC"], ["LAL", "LAL"], ["MEM", "MEM"],
  ["VAN", "MEM"], ["MIA", "MIA"], ["MIL", "MIL"], ["MIN", "MIN"],
  ["NOH", "NOP"], ["NOK", "NOP"], ["NOP", "NOP"], ["NYK", "NYK"],
  ["SEA", "OKC"], ["OKC", "OKC"], ["ORL", "ORL"], ["PHI", "PHI"],
  ["PHO", "PHX"], ["PHX", "PHX"], ["POR", "POR"], ["KCK", "SAC"],
  ["KCO", "SAC"], ["SAC", "SAC"], ["SAS", "SAS"], ["TOR", "TOR"],
  ["NOJ", "UTA"], ["UTA", "UTA"], ["WSB", "WAS"], ["WAS", "WAS"]
]);

const CURRENT_TEAMS = {
  ATL: ["Atlanta", "Hawks", "atl"], BOS: ["Boston", "Celtics", "bos"], BKN: ["Brooklyn", "Nets", "bkn"],
  CHA: ["Charlotte", "Hornets", "cha"], CHI: ["Chicago", "Bulls", "chi"], CLE: ["Cleveland", "Cavaliers", "cle"],
  DAL: ["Dallas", "Mavericks", "dal"], DEN: ["Denver", "Nuggets", "den"], DET: ["Detroit", "Pistons", "det"],
  GSW: ["Golden State", "Warriors", "gs"], HOU: ["Houston", "Rockets", "hou"], IND: ["Indiana", "Pacers", "ind"],
  LAC: ["Los Angeles", "Clippers", "lac"], LAL: ["Los Angeles", "Lakers", "lal"], MEM: ["Memphis", "Grizzlies", "mem"],
  MIA: ["Miami", "Heat", "mia"], MIL: ["Milwaukee", "Bucks", "mil"], MIN: ["Minnesota", "Timberwolves", "min"],
  NOP: ["New Orleans", "Pelicans", "no"], NYK: ["New York", "Knicks", "ny"], OKC: ["Oklahoma City", "Thunder", "okc"],
  ORL: ["Orlando", "Magic", "orl"], PHI: ["Philadelphia", "76ers", "phi"], PHX: ["Phoenix", "Suns", "phx"],
  POR: ["Portland", "Trail Blazers", "por"], SAC: ["Sacramento", "Kings", "sac"], SAS: ["San Antonio", "Spurs", "sa"],
  TOR: ["Toronto", "Raptors", "tor"], UTA: ["Utah", "Jazz", "utah"], WAS: ["Washington", "Wizards", "wsh"]
};

const FRANCHISE_ERAS = {
  BKN: [{ end: 2012, city: "New Jersey", name: "Nets", logoUrl: "https://content.sportslogos.net/logos/6/215/full/hvkhsaffs9x9zre7gku4vmnte.gif" }],
  CHA: [{ end: 2014, city: "Charlotte", name: "Bobcats", logoUrl: "https://content.sportslogos.net/logos/6/258/full/tytgxvgwe3r0hwqaehb3lxef7.gif" }],
  LAC: [
    { end: 1978, city: "Buffalo", name: "Braves", logoUrl: "https://commons.wikimedia.org/wiki/Special:Redirect/file/Buffalo_Braves_%28black_and_orange_varient%29_logo.svg" },
    { end: 1984, city: "San Diego", name: "Clippers", logoUrl: "https://content.sportslogos.net/logos/6/254/full/5465.gif" }
  ],
  MEM: [{ end: 2001, city: "Vancouver", name: "Grizzlies", logoUrl: "https://content.sportslogos.net/logos/6/257/full/7hc558rh9vls8j6fam4hly46n.gif" }],
  NOP: [
    { end: 2002, city: "Charlotte", name: "Hornets", logoUrl: "https://content.sportslogos.net/logos/6/256/full/charlotte_hornets_logo_primary_19896932.png" },
    { end: 2005, city: "New Orleans", name: "Hornets", logoUrl: "/historical/new-orleans-hornets.png" },
    { end: 2007, city: "New Orleans / Oklahoma City", name: "Hornets", logoUrl: "/historical/new-orleans-hornets.png" },
    { end: 2013, city: "New Orleans", name: "Hornets", logoUrl: "/historical/new-orleans-hornets.png" }
  ],
  OKC: [{ end: 2008, city: "Seattle", name: "SuperSonics", logoUrl: "https://content.sportslogos.net/logos/6/241/full/cxe7hh6lwjtpdhcoyiuc064sp.gif" }],
  SAC: [{ end: 1985, city: "Kansas City", name: "Kings", logoUrl: "https://content.sportslogos.net/logos/6/248/full/5383.png" }],
  UTA: [{ end: 1979, city: "New Orleans", name: "Jazz", logoUrl: "https://upload.wikimedia.org/wikipedia/commons/2/29/New_Orleans_Jazz_Logo%2C_1975-1979.png" }],
  WAS: [{ end: 1997, city: "Washington", name: "Bullets", logoUrl: "https://content.sportslogos.net/logos/6/587/full/washington-bullets-logo-primary-dark-1988-58715261988.png" }]
};

const DIFFICULTY_THRESHOLDS = { easy: 112, medium: 78, hard: 52, impossible: 22 };

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
      } else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (char !== "\r") cell += char;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  const [headers, ...data] = rows;
  return data.filter((values) => values.length > 1).map((values) =>
    Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]))
  );
}

async function fetchText(url) {
  const key = createHash("sha1").update(url).digest("hex");
  const cachePath = path.join(cacheDir, `${key}.csv`);
  if (existsSync(cachePath)) return readFile(cachePath, "utf8");
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
  const text = await response.text();
  await mkdir(cacheDir, { recursive: true });
  await writeFile(cachePath, text);
  return text;
}

async function fetchRows(url) {
  return parseCsv(await fetchText(url));
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
  return response.json();
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function bool(value) {
  return String(value).toLowerCase() === "true";
}

function normalizeName(value) {
  return String(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[.'’]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function slug(value) {
  return String(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function normalizePosition(position) {
  const value = String(position || "").toUpperCase().replace("FORWARD", "F").replace("GUARD", "G").replace("CENTER", "C");
  if (["PG", "SG", "SF", "PF", "C"].includes(value)) return value;
  if (value.includes("G") && value.includes("F")) return value.startsWith("G") ? "G-F" : "F-G";
  if (value.includes("F") && value.includes("C")) return value.startsWith("F") ? "F-C" : "C-F";
  if (value.includes("G")) return "G";
  if (value.includes("C")) return "C";
  return value.includes("F") ? "F" : "F";
}

function createPlayer(name) {
  return {
    id: "",
    fullName: name,
    espnId: "",
    bbrId: "",
    position: "F",
    headshotUrl: "",
    careerStatus: "retired",
    currentTeamId: null,
    seasons: new Map(),
    seasonStats: new Map()
  };
}

function getSourcePlayer(players, key, name) {
  let player = players.get(key);
  if (!player) {
    player = createPlayer(name);
    players.set(key, player);
  }
  return player;
}

function indexPlayerByName(index, player) {
  const key = normalizeName(player.fullName);
  const matches = index.get(key) ?? [];
  if (!matches.includes(player)) matches.push(player);
  index.set(key, matches);
}

function findHistoricalMatch(candidates, seasonEnd, teamId, position) {
  const available = candidates.filter((player) => !player.espnId);
  const sameSeasonAndTeam = available.find((player) => player.seasons.get(seasonEnd)?.has(teamId));
  if (sameSeasonAndTeam) return sameSeasonAndTeam;
  const normalizedPosition = normalizePosition(position);
  return available.find((player) => player.seasons.has(seasonEnd) && normalizePosition(player.position) === normalizedPosition) ?? null;
}

function normalizeTeam(team) {
  return TEAM_ALIASES.get(String(team).toUpperCase()) ?? null;
}

function addAppearance(player, seasonEnd, teamId, order = "") {
  if (!teamId || seasonEnd < 1977) return;
  let teams = player.seasons.get(seasonEnd);
  if (!teams) {
    teams = new Map();
    player.seasons.set(seasonEnd, teams);
  }
  // Game dates establish chronology inside a split season. Display years stay
  // tied to the NBA season itself: 2024-25 is represented by 2024 through 2025.
  const firstYear = seasonEnd - 1;
  const lastYear = seasonEnd;
  const existing = teams.get(teamId);
  if (!existing) {
    teams.set(teamId, { order, firstYear, lastYear });
    return;
  }
  if (!existing.order && order) {
    existing.order = order;
    return;
  }
  if (order && order < existing.order) existing.order = order;
  existing.firstYear = Math.min(existing.firstYear, firstYear);
  existing.lastYear = Math.max(existing.lastYear, lastYear);
}

function getSeasonStat(player, seasonEnd) {
  let stat = player.seasonStats.get(seasonEnd);
  if (!stat) {
    stat = { games: 0, minutes: 0, points: 0, rebounds: 0, assists: 0, steals: 0, blocks: 0, war: 0, gameIds: new Set() };
    player.seasonStats.set(seasonEnd, stat);
  }
  return stat;
}

function getEra(teamId, seasonEnd) {
  const era = FRANCHISE_ERAS[teamId]?.find((candidate) => seasonEnd <= candidate.end);
  if (era) {
    return {
      city: era.city,
      name: era.name,
      logoUrl: era.logoUrl ?? `https://a.espncdn.com/i/teamlogos/nba/500/${era.logo}.png`
    };
  }
  const [city, name, logo] = CURRENT_TEAMS[teamId];
  return { city, name, logoUrl: `https://a.espncdn.com/i/teamlogos/nba/500/${logo}.png` };
}

function sameIdentity(left, right) {
  return left.city === right.city && left.name === right.name && left.logoUrl === right.logoUrl;
}

function buildStints(player) {
  const seasons = [...player.seasons.entries()].sort((left, right) => left[0] - right[0]);
  const occurrences = seasons.flatMap(([seasonEnd, teams], seasonIndex) => {
    const previousTeams = new Set(seasons[seasonIndex - 1]?.[1].keys() ?? []);
    const nextTeams = new Set(seasons[seasonIndex + 1]?.[1].keys() ?? []);
    const entries = [...teams.entries()].map(([teamId, data]) => ({ seasonEnd, teamId, ...data }));
    entries.sort((left, right) => {
      if (left.order || right.order) return left.order.localeCompare(right.order);
      const leftRank = previousTeams.has(left.teamId) ? 0 : nextTeams.has(left.teamId) ? 2 : 1;
      const rightRank = previousTeams.has(right.teamId) ? 0 : nextTeams.has(right.teamId) ? 2 : 1;
      return leftRank - rightRank || left.teamId.localeCompare(right.teamId);
    });
    return entries.map((entry, index) => ({
      ...entry,
      // A team joined after the first stop in a split season starts in the
      // season-ending calendar year, matching standard NBA career tables.
      firstYear: entries.length > 1 && index > 0 ? seasonEnd : entry.firstYear
    }));
  });
  const stints = [];
  for (const occurrence of occurrences) {
    const identity = getEra(occurrence.teamId, occurrence.seasonEnd);
    const previous = stints.at(-1);
    // Missing an entire season (usually because of injury or time outside the
    // NBA) does not create a new career-path stop unless another NBA franchise
    // appears between the two runs.
    if (previous && previous.teamId === occurrence.teamId) {
      previous.endYear = occurrence.lastYear;
      previous.lastSeasonEnd = occurrence.seasonEnd;
      if (!previous.identities.some((candidate) => sameIdentity(candidate, identity))) previous.identities.push(identity);
      continue;
    }
    stints.push({
      teamId: occurrence.teamId,
      startYear: occurrence.firstYear,
      endYear: occurrence.lastYear,
      lastSeasonEnd: occurrence.seasonEnd,
      identities: [identity]
    });
  }

  if (player.careerStatus === "signed" && player.currentTeamId) {
    const last = stints.at(-1);
    if (last?.teamId === player.currentTeamId) {
      last.endYear = null;
    } else {
      stints.push({
        teamId: player.currentTeamId,
        startYear: CURRENT_SEASON_END,
        endYear: null,
        lastSeasonEnd: CURRENT_SEASON_END + 1,
        identities: [getEra(player.currentTeamId, CURRENT_SEASON_END + 1)]
      });
    }
  }

  return stints.map(({ lastSeasonEnd: _lastSeasonEnd, identities, ...stint }) => {
    const current = getEra(stint.teamId, Number.MAX_SAFE_INTEGER);
    const needsIdentities = identities.length > 1 || !sameIdentity(identities[0], current);
    return needsIdentities ? { ...stint, identities } : stint;
  });
}

function calculateFamiliarity(player, uniqueTeamCount) {
  const seasons = [...player.seasonStats.values()];
  const career = seasons.reduce((total, stat) => ({
    games: total.games + stat.games,
    minutes: total.minutes + stat.minutes,
    points: total.points + stat.points,
    rebounds: total.rebounds + stat.rebounds,
    assists: total.assists + stat.assists,
    steals: total.steals + stat.steals,
    blocks: total.blocks + stat.blocks,
    war: total.war + stat.war
  }), { games: 0, minutes: 0, points: 0, rebounds: 0, assists: 0, steals: 0, blocks: 0, war: 0 });
  const peaks = seasons.map((stat) => {
    const games = Math.max(stat.games, 1);
    return stat.points / games * 0.9 + stat.rebounds / games * 0.55 + stat.assists / games * 0.8 +
      (stat.steals + stat.blocks) / games * 1.5 + Math.max(0, stat.war) * 1.5;
  });
  const peak = Math.max(0, ...peaks);
  const lastSeason = Math.max(...player.seasons.keys());
  const seasonsAgo = Math.max(0, CURRENT_SEASON_END - lastSeason);
  const recency = player.careerStatus !== "retired" ? 15 : seasonsAgo <= 3 ? 12 : seasonsAgo <= 7 ? 8 : seasonsAgo <= 12 ? 4 : 0;
  const longevity = Math.min(28, career.games / 38 + career.minutes / 4500);
  const production = Math.min(38,
    career.points / 650 + career.rebounds / 900 + career.assists / 650 + (career.steals + career.blocks) / 260
  );
  const peakScore = Math.min(38, peak);
  const impact = Math.min(17, Math.max(0, career.war) / 4);
  const teams = Math.min(7, uniqueTeamCount * 1.25);
  const familiarity = Math.round((longevity + production + peakScore + impact + teams + recency) * 10) / 10;
  return { familiarity, breakdown: { longevity, production, peak: peakScore, impact, teams, recency }, career };
}

function difficultyFor(score) {
  if (score >= DIFFICULTY_THRESHOLDS.easy) return "easy";
  if (score >= DIFFICULTY_THRESHOLDS.medium) return "medium";
  if (score >= DIFFICULTY_THRESHOLDS.hard) return "hard";
  return "impossible";
}

function mulberry32(seed) {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6d2b79f5) | 0;
    let next = Math.imul(value ^ (value >>> 15), 1 | value);
    next = (next + Math.imul(next ^ (next >>> 7), 61 | next)) ^ next;
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled(items, seed) {
  const result = [...items];
  const random = mulberry32(seed);
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [result[index], result[swap]] = [result[swap], result[index]];
  }
  return result;
}

async function main() {
  const players = new Map();
  const historicalByName = new Map();
  const espnPlayers = new Map();
  console.log("Loading historical NBA careers...");
  const historicalRows = await fetchRows(RAPTOR_URL);
  for (const row of historicalRows) {
    const seasonEnd = number(row.year_id);
    if (row.type !== "RS" || seasonEnd > 2020) continue;
    const teamId = normalizeTeam(row.team_id);
    if (!teamId) continue;
    const historicalKey = `bbr:${row.player_id || normalizeName(row.name_common)}`;
    const player = getSourcePlayer(players, historicalKey, row.name_common);
    indexPlayerByName(historicalByName, player);
    player.bbrId ||= row.player_id;
    player.position = normalizePosition(row.pos || player.position);
    addAppearance(player, seasonEnd, teamId);
    const stat = getSeasonStat(player, seasonEnd);
    const games = number(row.G);
    const minutes = number(row.Min);
    stat.games += games;
    stat.minutes += minutes;
    stat.points += number(row["P/36"]) * minutes / 36;
    stat.rebounds += number(row["R/36"]) * minutes / 36;
    stat.assists += number(row["A/36"]) * minutes / 36;
    stat.steals += number(row["SB/36"]) * minutes / 72;
    stat.blocks += number(row["SB/36"]) * minutes / 72;
    stat.war += number(row["Raptor WAR"]);
  }

  for (let season = BOX_SCORE_START; season <= CURRENT_SEASON_END; season += 1) {
    console.log(`Loading ${season - 1}-${String(season).slice(-2)} game appearances...`);
    const rows = await fetchRows(PLAYER_BOX_URL(season));
    for (const row of rows) {
      if (row.season_type !== "2" || bool(row.did_not_play)) continue;
      const teamId = TEAM_BY_ESPN_ID.get(row.team_id);
      if (!teamId) continue;
      let player = espnPlayers.get(row.athlete_id);
      if (!player) {
        player = findHistoricalMatch(
          historicalByName.get(normalizeName(row.athlete_display_name)) ?? [],
          season,
          teamId,
          row.athlete_position_abbreviation
        );
        if (!player) {
          player = getSourcePlayer(players, `espn:${row.athlete_id}`, row.athlete_display_name);
        }
        player.espnId = row.athlete_id;
        espnPlayers.set(row.athlete_id, player);
      }
      player.espnId ||= row.athlete_id;
      player.position = normalizePosition(row.athlete_position_abbreviation || player.position);
      player.headshotUrl ||= row.athlete_headshot_href;
      addAppearance(player, season, teamId, row.game_date);
      // RAPTOR supplies the historical production model through 2019-20. The
      // ESPN rows before 2020-21 are used only to date and order team stops.
      if (season <= 2020) continue;
      const stat = getSeasonStat(player, season);
      if (stat.gameIds.has(row.game_id)) continue;
      stat.gameIds.add(row.game_id);
      stat.games += 1;
      stat.minutes += number(row.minutes);
      stat.points += number(row.points);
      stat.rebounds += number(row.rebounds);
      stat.assists += number(row.assists);
      stat.steals += number(row.steals);
      stat.blocks += number(row.blocks);
    }
  }

  console.log("Loading current NBA roster status...");
  const currentRows = await fetchRows(PLAYER_CORE_URL(CURRENT_SEASON_END));
  const previouslySigned = new Set();
  for (const row of currentRows) {
    const player = espnPlayers.get(row.athlete_id);
    if (!player) continue;
    player.espnId ||= row.athlete_id;
    player.position = normalizePosition(row.position_abbreviation || player.position);
    player.headshotUrl = row.headshot_href || player.headshotUrl;
    const statusType = String(row.status_type).toLowerCase();
    if (statusType.includes("free-agent")) player.careerStatus = "free_agent";
    else if (bool(row.active)) {
      player.careerStatus = "signed";
      previouslySigned.add(player);
    }
    player.currentTeamId = TEAM_BY_ESPN_ID.get(row.current_team_id) ?? null;
  }

  console.log("Loading live NBA team rosters...");
  const currentRosterPlayers = new Set();
  const rosterResults = await Promise.all(
    Object.entries(CURRENT_TEAMS).map(async ([teamId, [, , teamSlug]]) => {
      try {
        const roster = await fetchJson(CURRENT_ROSTER_URL(teamSlug));
        return { teamId, athletes: Array.isArray(roster.athletes) ? roster.athletes : [], error: null };
      } catch (error) {
        return { teamId, athletes: [], error };
      }
    })
  );

  for (const result of rosterResults) {
    if (result.error) {
      console.warn(`Skipping live roster ${result.teamId}: ${result.error instanceof Error ? result.error.message : result.error}`);
      continue;
    }
    for (const athlete of result.athletes) {
      const player = espnPlayers.get(String(athlete.id));
      if (!player) continue;
      currentRosterPlayers.add(player);
      player.careerStatus = "signed";
      player.currentTeamId = result.teamId;
      player.position = normalizePosition(athlete.position?.abbreviation || player.position);
      player.headshotUrl = athlete.headshot?.href || player.headshotUrl;
    }
  }

  // The completed-season player core can still call an offseason departure
  // active on his old club. Once every live team roster loaded successfully,
  // treat those unmatched players as free agents rather than keeping a stale
  // signed team. Partial roster failures retain the older status as a fallback.
  if (rosterResults.every((result) => !result.error)) {
    for (const player of previouslySigned) {
      if (currentRosterPlayers.has(player)) continue;
      player.careerStatus = "free_agent";
      player.currentTeamId = null;
    }
  }

  const output = [];
  const debug = [];
  const usedIds = new Set();
  for (const player of players.values()) {
    const stints = buildStints(player);
    const uniqueTeamCount = new Set(stints.map((stint) => stint.teamId)).size;
    if (uniqueTeamCount < 2) continue;
    const { familiarity, breakdown, career } = calculateFamiliarity(player, uniqueTeamCount);
    if (familiarity < DIFFICULTY_THRESHOLDS.impossible) continue;
    const baseId = player.espnId ? `nba-${player.espnId}` : `nba-${player.bbrId || slug(player.fullName)}`;
    let id = baseId;
    let suffix = 2;
    while (usedIds.has(id)) id = `${baseId}-${suffix++}`;
    usedIds.add(id);
    const entry = {
      id,
      fullName: player.fullName,
      position: player.position,
      difficulty: difficultyFor(familiarity),
      familiarity,
      careerStatus: player.careerStatus,
      headshotUrl: player.headshotUrl,
      teamStints: stints,
      uniqueTeamCount
    };
    output.push(entry);
    const careerStartYear = Math.min(...stints.map((stint) => stint.startYear));
    const careerEndYear = Math.max(...stints.map((stint) => stint.endYear ?? CURRENT_SEASON_END));
    debug.push({ id, familiarity, difficulty: entry.difficulty, position: entry.position,
      seasonCount: player.seasons.size, uniqueTeamCount, careerStartYear, careerEndYear,
      yearsAgo: player.careerStatus === "retired" ? Math.max(0, CURRENT_SEASON_END - careerEndYear) : 0,
      career: {
      games: Math.round(career.games), minutes: Math.round(career.minutes), points: Math.round(career.points),
      rebounds: Math.round(career.rebounds), assists: Math.round(career.assists), steals: Math.round(career.steals), blocks: Math.round(career.blocks)
    }, breakdown: Object.fromEntries(Object.entries(breakdown).map(([key, value]) => [key, Math.round(value * 10) / 10])) });
  }

  output.sort((left, right) => left.fullName.localeCompare(right.fullName));
  debug.sort((left, right) => left.id.localeCompare(right.id));
  const recentCutoff = CURRENT_SEASON_END - 10;
  const dailyEligible = output.filter((player) =>
    player.teamStints.length >= 4 &&
    (player.difficulty === "medium" || player.difficulty === "hard") &&
    (player.careerStatus !== "retired" || Math.max(...player.teamStints.map((stint) => stint.endYear ?? CURRENT_SEASON_END)) >= recentCutoff)
  );
  const publishedDays = Math.max(0, Math.floor((Date.now() - DAILY_EPOCH) / 86_400_000) + 1);
  let frozenSchedule = [];
  if (existsSync(scheduleOutputPath)) {
    const existingSource = await readFile(scheduleOutputPath, "utf8");
    const arrayStart = existingSource.indexOf("[", existingSource.indexOf("NBA_DAILY_CHALLENGE_SCHEDULE"));
    const arrayEnd = existingSource.indexOf("] as const", arrayStart) + 1;
    if (arrayStart >= 0 && arrayEnd > arrayStart) {
      frozenSchedule = JSON.parse(existingSource.slice(arrayStart, arrayEnd)).slice(0, publishedDays);
    }
  }
  const frozenIds = new Set(frozenSchedule);
  const dailyCycle = shuffled(dailyEligible.map((player) => player.id).filter((id) => !frozenIds.has(id)), DAILY_SEED);
  const schedule = [...frozenSchedule, ...dailyCycle].slice(0, DAILY_SCHEDULE_LENGTH);

  const header = `// Generated by scripts/generate-nba-player-catalog.mjs. Do not edit by hand.\n`;
  await writeFile(outputPath, `${header}export const GENERATED_NBA_PLAYERS = ${JSON.stringify(output, null, 2)} as const;\n`);
  await writeFile(debugOutputPath, `${header}export const GENERATED_NBA_PLAYER_DEBUG = ${JSON.stringify(debug, null, 2)} as const;\nexport const NBA_DIFFICULTY_THRESHOLDS = ${JSON.stringify(DIFFICULTY_THRESHOLDS, null, 2)} as const;\n`);
  await writeFile(scheduleOutputPath, `${header}export const NBA_DAILY_CHALLENGE_SCHEDULE = ${JSON.stringify(schedule, null, 2)} as const;\n`);

  const counts = output.reduce((result, player) => {
    result[player.difficulty].push(player);
    return result;
  }, { easy: [], medium: [], hard: [], impossible: [] });
  console.log(`Generated ${output.length} multi-franchise NBA players.`);
  console.log(`Easy ${counts.easy?.length ?? 0}, Medium ${counts.medium?.length ?? 0}, Hard ${counts.hard?.length ?? 0}, Impossible ${counts.impossible?.length ?? 0}`);
  console.log(`Daily candidates: ${dailyEligible.length}; scheduled: ${schedule.length}`);
}

await main();
