import { Fragment } from "react";

import { NFL_TEAMS, formatTeamLabel } from "@/lib/nfl-teams";
import type { TeamStint } from "@/lib/types";
import { formatYearRange } from "@/lib/utils";

export function TeamPath({
  teamStints,
  showYears
}: {
  teamStints: TeamStint[];
  showYears: boolean;
}) {
  return (
    <div className="flex flex-wrap items-stretch justify-center gap-2 sm:gap-2.5">
      {teamStints.map((stint, index) => {
        const team = NFL_TEAMS[stint.teamId];
        return (
          <Fragment key={`${stint.teamId}-${index}-${stint.startYear}`}>
            {index > 0 ? (
              <span
                aria-hidden
                className="font-pixel text-helmet flex items-center text-base leading-none select-none sm:text-lg"
              >
                ▶
              </span>
            ) : null}
            <article
              className="flex w-[120px] flex-col items-center justify-center gap-1 border-4 p-1.5 text-center sm:w-[148px] sm:gap-1.5 sm:p-2"
              style={{ borderColor: team.primary, backgroundColor: "#58a045" }}
            >
              <img
                src={team.logoUrl}
                alt=""
                width={56}
                height={56}
                className="h-10 w-10 object-contain sm:h-12 sm:w-12"
              />
              <p
                className="font-readable text-[#0a2a14] flex items-center justify-center text-sm leading-tight sm:text-base"
                style={{ minHeight: "2.5em" }}
              >
                {formatTeamLabel(stint.teamId)}
              </p>
              {showYears ? (
                <p className="font-pixel text-white text-[0.5rem] leading-tight sm:text-[0.55rem]">
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
