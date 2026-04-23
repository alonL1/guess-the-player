import { relations } from "drizzle-orm";
import { index, integer, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const players = pgTable(
  "players",
  {
    id: text("id").primaryKey(),
    fullName: text("full_name").notNull(),
    normalizedName: text("normalized_name").notNull(),
    difficulty: text("difficulty").notNull(),
    headshotUrl: text("headshot_url").notNull(),
    uniqueTeamCount: integer("unique_team_count").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
  },
  (table) => ({
    normalizedNameIdx: index("players_normalized_name_idx").on(table.normalizedName),
    fullNameUnique: uniqueIndex("players_full_name_unique").on(table.fullName)
  })
);

export const teamStints = pgTable(
  "team_stints",
  {
    id: text("id").primaryKey(),
    playerId: text("player_id")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    stintOrder: integer("stint_order").notNull(),
    teamId: text("team_id").notNull(),
    startYear: integer("start_year").notNull(),
    endYear: integer("end_year"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
  },
  (table) => ({
    playerStintIdx: index("team_stints_player_stint_idx").on(table.playerId, table.stintOrder)
  })
);

export const playersRelations = relations(players, ({ many }) => ({
  teamStints: many(teamStints)
}));

export const teamStintsRelations = relations(teamStints, ({ one }) => ({
  player: one(players, {
    fields: [teamStints.playerId],
    references: [players.id]
  })
}));
