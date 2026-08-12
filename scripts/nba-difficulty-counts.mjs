import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../src/lib/generated-nba-player-catalog.ts", import.meta.url), "utf8");
const assignment = source.indexOf("=", source.indexOf("GENERATED_NBA_PLAYERS"));
const end = source.indexOf(" as const", assignment);
const GENERATED_NBA_PLAYERS = JSON.parse(source.slice(assignment + 1, end));

const currentOnly = process.argv.includes("--current");
const players = currentOnly
  ? GENERATED_NBA_PLAYERS.filter((player) => player.careerStatus === "signed" || player.careerStatus === "free_agent")
  : GENERATED_NBA_PLAYERS;

console.log(currentOnly ? "NBA current/free-agent players\n" : "NBA all players\n");
for (const difficulty of ["easy", "medium", "hard", "impossible"]) {
  const matching = players.filter((player) => player.difficulty === difficulty);
  const guards = matching.filter((player) => ["PG", "SG", "G", "G-F"].includes(player.position)).length;
  const bigs = matching.filter((player) => ["PF", "C", "F-C", "C-F"].includes(player.position)).length;
  const wings = matching.length - guards - bigs;
  console.log(`${difficulty[0].toUpperCase()}${difficulty.slice(1)} total: ${matching.length}`);
  console.log(`Guards: ${guards}, Wings: ${wings}, Bigs: ${bigs}\n`);
}
console.log(`All players: ${players.length}`);
