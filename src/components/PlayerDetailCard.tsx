import { TeamPath } from "@/components/TeamPath";
import type { PlayerCatalogEntry } from "@/lib/types";

// Compact player card: headshot, name, position + difficulty tags, and the full
// career path. Reused by the end-of-game summaries (inline expand) and the
// "sickest pull" callout in both Solo and Room.
export function PlayerDetailCard({ player }: { player: PlayerCatalogEntry }) {
  return (
    <div className="grid gap-3 sm:gap-5 lg:grid-cols-[180px_1fr] lg:items-start">
      <div className="mx-auto w-28 overflow-hidden border-4 border-helmet bg-endzone sm:w-40 lg:mx-0 lg:w-auto">
        <img
          src={player.headshotUrl}
          alt={player.fullName}
          width={320}
          height={320}
          className="h-auto w-full object-cover"
        />
      </div>
      <div>
        <h3 className="font-pixel text-chalk break-words text-sm sm:text-lg lg:text-xl">{player.fullName}</h3>
        <div className="mt-3 flex flex-wrap gap-2">
          <span className="pixel-tag pixel-tag-yellow">{player.position}</span>
          <span className="pixel-tag pixel-tag-blue capitalize">{player.difficulty}</span>
        </div>
        <div className="mt-4">
          <TeamPath teamStints={player.teamStints} showYears />
        </div>
      </div>
    </div>
  );
}
