import { getDatabase } from "@/server/db/client";

async function main() {
  const database = getDatabase();
  if (!database) {
    throw new Error("DATABASE_URL is required");
  }

  await database.client`
    create table if not exists players (
      id text primary key,
      full_name text not null,
      normalized_name text not null,
      difficulty text not null,
      headshot_url text not null,
      unique_team_count integer not null,
      created_at timestamptz not null default now()
    );
  `;

  await database.client`
    create unique index if not exists players_full_name_unique on players(full_name);
  `;

  await database.client`
    create index if not exists players_normalized_name_idx on players(normalized_name);
  `;

  await database.client`
    create table if not exists team_stints (
      id text primary key,
      player_id text not null references players(id) on delete cascade,
      stint_order integer not null,
      team_id text not null,
      start_year integer not null,
      end_year integer,
      created_at timestamptz not null default now()
    );
  `;

  await database.client`
    create index if not exists team_stints_player_stint_idx on team_stints(player_id, stint_order);
  `;
}

void main()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
