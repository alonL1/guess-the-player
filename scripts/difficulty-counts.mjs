import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Prints catalog difficulty totals, broken down by side of the ball.
// Run: node scripts/difficulty-counts.mjs
// Current-only: node scripts/difficulty-counts.mjs --current

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const file = path.join(__dirname, "..", "src/lib/generated-player-catalog.ts");
const src = readFileSync(file, "utf8");
const start = src.indexOf("[", src.indexOf("GENERATED_PLAYERS"));
const end = src.indexOf("] as const", start) + 1;
const allPlayers = JSON.parse(src.slice(start, end));
const currentOnly = process.argv.slice(2).some((arg) => ["--current", "current", "-c"].includes(arg));
const players = currentOnly
  ? allPlayers.filter((player) => player.careerStatus === "signed" || player.careerStatus === "free_agent")
  : allPlayers;

const OFFENSE = new Set(["QB", "RB", "FB", "WR", "TE"]);
const SPECIAL = new Set(["K", "P"]);
const side = (pos) => (OFFENSE.has(pos) ? "off" : SPECIAL.has(pos) ? "st" : "def");

const order = ["easy", "medium", "hard", "impossible"];
const label = { easy: "Easy", medium: "Medium", hard: "Hard", impossible: "Impossible" };
const counts = Object.fromEntries(order.map((d) => [d, { total: 0, off: 0, def: 0, st: 0 }]));

if (currentOnly) {
  console.log("Current-only players\n");
}

for (const player of players) {
  const bucket = counts[player.difficulty];
  if (!bucket) continue;
  bucket.total += 1;
  bucket[side(player.position)] += 1;
}

for (const d of order) {
  const c = counts[d];
  console.log(`${label[d]} total: ${c.total}`);
  console.log(`Offense: ${c.off}, Defense: ${c.def}, Special Teams: ${c.st}\n`);
}
console.log(`${currentOnly ? "Current-only" : "All"} players: ${players.length}`);
