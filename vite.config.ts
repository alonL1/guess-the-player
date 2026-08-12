import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

const isNba = process.env.VITE_SPORT === "nba";

export default defineConfig({
  publicDir: isNba ? "public/nba" : "public",
  plugins: [
    react(),
    {
      name: "sport-metadata",
      transformIndexHtml(html: string) {
        if (!isNba) {
          return html.replaceAll("https://pathguessr.app", "https://nfl.pathguessr.app");
        }
        return html
          .replaceAll("NFL Path Guesser", "NBA Path Guesser")
          .replaceAll("test your ball knowledge", "test your hoops knowledge")
          .replaceAll("https://pathguessr.app", "https://nba.pathguessr.app")
          .replace("#1a5c2e", "#171b25")
          .replace("a pixel football on an astroturf field", "a retro basketball court and arena scoreboard");
      }
    }
  ],
  resolve: {
    alias: {
      "@/lib/active-generated-catalog": path.resolve(
        __dirname,
        isNba ? "./src/lib/nba-active-generated-catalog.ts" : "./src/lib/active-generated-catalog.ts"
      ),
      "@/lib/generated-player-debug": path.resolve(
        __dirname,
        isNba ? "./src/lib/generated-nba-player-debug-adapter.ts" : "./src/lib/generated-player-debug.ts"
      ),
      "@": path.resolve(__dirname, "./src")
    }
  },
  server: {
    port: 5173,
    watch: {
      ignored: ["**/.partykit/**", "**/dist/**", "**/.wrangler/**"]
    }
  },
  build: {
    outDir: isNba ? "dist-nba" : "dist"
  }
});
