import { Fragment } from "react";

import { NFL_TEAMS } from "@/lib/nfl-teams";
import type { TeamStint } from "@/lib/types";
import { formatYearRange } from "@/lib/utils";

export function TeamPath({
  teamStints,
  showYears,
  compact = false,
  tone = "default"
}: {
  teamStints: TeamStint[];
  showYears: boolean;
  compact?: boolean;
  tone?: "default" | "danger";
}) {
  const isDanger = tone === "danger";
  const cardBg = isDanger ? "#c0392b" : "#58a045";
  const nameColor = isDanger ? "#ffffff" : "#0a2a14";
  const yearsClass = isDanger ? "text-white/80" : "text-white";
  const arrowClass = isDanger ? "text-jersey-red" : "text-helmet";

  const wrapGap = compact ? "gap-1.5 sm:gap-2" : "gap-2 sm:gap-2.5";
  const arrowText = compact ? "text-sm sm:text-base" : "text-base sm:text-lg";
  const cardSize = compact
    ? "w-[84px] gap-0.5 p-1 sm:w-[100px] sm:p-1.5"
    : "w-[120px] gap-1 p-1.5 sm:w-[148px] sm:gap-1.5 sm:p-2";
  const logoSize = compact ? "h-7 w-7 sm:h-8 sm:w-8" : "h-10 w-10 sm:h-12 sm:w-12";
  const nameSize = compact ? "text-[0.7rem] sm:text-xs" : "text-sm sm:text-base";
  const nameMinHeight = compact ? "2.2em" : "2.5em";
  const yearsSize = compact ? "text-[0.4rem] sm:text-[0.45rem]" : "text-[0.5rem] sm:text-[0.55rem]";

  return (
    <div className={`flex flex-wrap items-stretch justify-center ${wrapGap}`}>
      {teamStints.map((stint, index) => {
        const team = NFL_TEAMS[stint.teamId];
        // Era-correct overrides (relocations/renames) fall back to the current
        // franchise identity when absent.
        const logoUrl = stint.logoUrl ?? team.logoUrl;
        const label = `${stint.city ?? team.city} ${stint.name ?? team.name}`;
        return (
          <Fragment key={`${stint.teamId}-${index}-${stint.startYear}`}>
            {index > 0 ? (
              <span
                aria-hidden
                className={`font-pixel ${arrowClass} flex items-center leading-none select-none ${arrowText}`}
              >
                ▶
              </span>
            ) : null}
            <article
              className={`flex flex-col items-center justify-center border-4 text-center ${cardSize}`}
              style={{ borderColor: isDanger ? "#7a1620" : team.primary, backgroundColor: cardBg }}
            >
              <img src={logoUrl} alt="" width={56} height={56} className={`${logoSize} object-contain`} />
              <p
                className={`font-readable flex items-center justify-center leading-tight ${nameSize}`}
                style={{ minHeight: nameMinHeight, color: nameColor }}
              >
                {label}
              </p>
              {showYears ? (
                <p className={`font-pixel ${yearsClass} leading-tight ${yearsSize}`}>
                  {formatYearRange(stint.startYear, stint.endYear)}
                </p>
              ) : null}
            </article>
          </Fragment>
        );
      })}
    </div>
  );
}
