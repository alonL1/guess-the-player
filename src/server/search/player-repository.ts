import { asc, eq, ilike, inArray } from "drizzle-orm";

import { starterCatalog } from "@/lib/data/starter-catalog";
import type { Difficulty, PlayerCatalogEntry } from "@/lib/types";
import { normalizeSearchText } from "@/lib/utils";
import { getDatabase } from "@/server/db/client";
import { players, teamStints } from "@/server/db/schema";

function mapRowsToCatalog(rows: Array<typeof players.$inferSelect & { teamStints: typeof teamStints.$inferSelect[] }>) {
  return rows
    .map((row) => ({
      id: row.id,
      fullName: row.fullName,
      normalizedName: row.normalizedName,
      difficulty: row.difficulty as Difficulty,
      headshotUrl: row.headshotUrl,
      uniqueTeamCount: row.uniqueTeamCount,
      teamStints: row.teamStints
        .sort((left, right) => left.stintOrder - right.stintOrder)
        .map((stint) => ({
          teamId: stint.teamId as PlayerCatalogEntry["teamStints"][number]["teamId"],
          startYear: stint.startYear,
          endYear: stint.endYear
        }))
    }))
    .filter((player) => player.uniqueTeamCount > 1);
}

async function loadFromDatabase() {
  const database = getDatabase();
  if (!database) {
    return null;
  }

  const playerRows = await database.db.query.players.findMany({
    with: {
      teamStints: {
        orderBy: [asc(teamStints.stintOrder)]
      }
    },
    orderBy: [asc(players.fullName)]
  });

  return mapRowsToCatalog(playerRows);
}

let cachedCatalog: PlayerCatalogEntry[] | null = null;
let cachedAt = 0;

export async function getCatalog(forceRefresh = false) {
  if (!forceRefresh && cachedCatalog && Date.now() - cachedAt < 60_000) {
    return cachedCatalog;
  }

  const fromDatabase = await loadFromDatabase();
  cachedCatalog = fromDatabase && fromDatabase.length > 0 ? fromDatabase : starterCatalog;
  cachedAt = Date.now();
  return cachedCatalog;
}

export async function findPlayerById(playerId: string) {
  const catalog = await getCatalog();
  return catalog.find((player) => player.id === playerId) ?? null;
}

export async function getEligiblePlayers(difficulties: Difficulty[], usedIds: string[]) {
  const used = new Set(usedIds);
  const catalog = await getCatalog();
  return catalog.filter((player) => difficulties.includes(player.difficulty) && !used.has(player.id) && player.uniqueTeamCount > 1);
}

export async function searchPlayers(query: string, limit = 8) {
  const normalized = normalizeSearchText(query);
  if (!normalized) {
    return [];
  }

  const database = getDatabase();
  if (database) {
    const rows = await database.db
      .select({
        id: players.id,
        fullName: players.fullName,
        normalizedName: players.normalizedName
      })
      .from(players)
      .where(ilike(players.normalizedName, `%${normalized}%`))
      .limit(limit * 2);

    return rows
      .sort((left, right) => {
        const leftStarts = left.normalizedName.startsWith(normalized) ? 0 : 1;
        const rightStarts = right.normalizedName.startsWith(normalized) ? 0 : 1;
        if (leftStarts !== rightStarts) {
          return leftStarts - rightStarts;
        }
        return left.fullName.localeCompare(right.fullName);
      })
      .slice(0, limit)
      .map(({ id, fullName }) => ({ id, fullName }));
  }

  const catalog = await getCatalog();
  return catalog
    .filter((player) => player.normalizedName.includes(normalized))
    .sort((left, right) => {
      const leftStarts = left.normalizedName.startsWith(normalized) ? 0 : 1;
      const rightStarts = right.normalizedName.startsWith(normalized) ? 0 : 1;
      if (leftStarts !== rightStarts) {
        return leftStarts - rightStarts;
      }
      return left.fullName.localeCompare(right.fullName);
    })
    .slice(0, limit)
    .map(({ id, fullName }) => ({ id, fullName }));
}

export async function writeCatalogToDatabase() {
  const database = getDatabase();
  if (!database) {
    throw new Error("DATABASE_URL is required to seed the database");
  }

  const catalog = starterCatalog;
  await database.db.delete(teamStints);
  await database.db.delete(players);

  await database.db.insert(players).values(
    catalog.map((player) => ({
      id: player.id,
      fullName: player.fullName,
      normalizedName: player.normalizedName,
      difficulty: player.difficulty,
      headshotUrl: player.headshotUrl,
      uniqueTeamCount: player.uniqueTeamCount
    }))
  );

  await database.db.insert(teamStints).values(
    catalog.flatMap((player) =>
      player.teamStints.map((stint, index) => ({
        id: `${player.id}-${index + 1}`,
        playerId: player.id,
        stintOrder: index,
        teamId: stint.teamId,
        startYear: stint.startYear,
        endYear: stint.endYear
      }))
    )
  );

  cachedCatalog = null;
}
