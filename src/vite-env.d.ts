/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PARTYKIT_HOST: string;
  readonly VITE_SPORT?: "nfl" | "nba";
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
