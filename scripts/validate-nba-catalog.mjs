import { readFile } from "node:fs/promises";

async function readGeneratedArray(relativePath, exportName) {
  const source = await readFile(new URL(relativePath, import.meta.url), "utf8");
  const assignment = source.indexOf("=", source.indexOf(exportName));
  const end = source.indexOf(" as const", assignment);
  return JSON.parse(source.slice(assignment + 1, end));
}

const GENERATED_NBA_PLAYERS = await readGeneratedArray("../src/lib/generated-nba-player-catalog.ts", "GENERATED_NBA_PLAYERS");
const NBA_DAILY_CHALLENGE_SCHEDULE = await readGeneratedArray("../src/lib/nba-daily-challenge-schedule.ts", "NBA_DAILY_CHALLENGE_SCHEDULE");
const GENERATED_NBA_PLAYER_DEBUG = await readGeneratedArray("../src/lib/generated-nba-player-debug.ts", "GENERATED_NBA_PLAYER_DEBUG");

const VALID_TEAMS = new Set([
  "ATL", "BOS", "BKN", "CHA", "CHI", "CLE", "DAL", "DEN", "DET", "GSW",
  "HOU", "IND", "LAC", "LAL", "MEM", "MIA", "MIL", "MIN", "NOP", "NYK",
  "OKC", "ORL", "PHI", "PHX", "POR", "SAC", "SAS", "TOR", "UTA", "WAS"
]);
const VALID_DIFFICULTIES = new Set(["easy", "medium", "hard", "impossible"]);
const ids = new Set();
const errors = [];
const debugById = new Map(GENERATED_NBA_PLAYER_DEBUG.map((entry) => [entry.id, entry]));

for (const player of GENERATED_NBA_PLAYERS) {
  if (ids.has(player.id)) errors.push(`${player.fullName}: duplicate id ${player.id}`);
  ids.add(player.id);
  const uniqueTeams = new Set(player.teamStints.map((stint) => stint.teamId));
  if (uniqueTeams.size < 2) errors.push(`${player.fullName}: fewer than two franchises`);
  if (uniqueTeams.size !== player.uniqueTeamCount) errors.push(`${player.fullName}: incorrect uniqueTeamCount`);
  if (!VALID_DIFFICULTIES.has(player.difficulty)) errors.push(`${player.fullName}: invalid difficulty`);
  if (player.teamStints.length === 0) errors.push(`${player.fullName}: no team stints`);
  const debug = debugById.get(player.id);
  if (!debug) {
    errors.push(`${player.fullName}: missing difficulty debug record`);
  } else if (debug.careerEndYear - debug.careerStartYear + 1 - debug.seasonCount > 12) {
    errors.push(`${player.fullName}: implausible career gap may indicate two same-name players were merged`);
  }

  for (const [index, stint] of player.teamStints.entries()) {
    if (!VALID_TEAMS.has(stint.teamId)) errors.push(`${player.fullName}: unknown team ${stint.teamId}`);
    if (stint.endYear !== null && stint.endYear < stint.startYear) {
      errors.push(`${player.fullName}: ${stint.teamId} ends before it starts`);
    }
    if (stint.endYear === null && index !== player.teamStints.length - 1) {
      errors.push(`${player.fullName}: current stint is not last`);
    }
    if (index > 0 && player.teamStints[index - 1].teamId === stint.teamId) {
      errors.push(`${player.fullName}: adjacent duplicate franchise ${stint.teamId}`);
    }
  }
}

const scheduleIds = new Set();
for (const playerId of NBA_DAILY_CHALLENGE_SCHEDULE) {
  if (!ids.has(playerId)) errors.push(`Daily schedule references missing player ${playerId}`);
  if (scheduleIds.has(playerId)) errors.push(`Daily schedule repeats ${playerId}`);
  scheduleIds.add(playerId);
}

if (errors.length > 0) {
  console.error(errors.slice(0, 50).join("\n"));
  if (errors.length > 50) console.error(`...and ${errors.length - 50} more`);
  process.exitCode = 1;
} else {
  console.log(`NBA catalog valid: ${GENERATED_NBA_PLAYERS.length} players, ${NBA_DAILY_CHALLENGE_SCHEDULE.length} scheduled dailies.`);
}
