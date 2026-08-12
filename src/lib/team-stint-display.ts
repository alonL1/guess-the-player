import { NFL_TEAMS } from "@/lib/nfl-teams";
import type { TeamStint } from "@/lib/types";

type ResolvedIdentity = {
  city: string;
  name: string;
  logoUrl: string;
};

export function getTeamStintDisplay(stint: TeamStint) {
  const team = NFL_TEAMS[stint.teamId];
  const rawIdentities = stint.identities ?? [stint];
  const identities = rawIdentities
    .map<ResolvedIdentity>((identity) => ({
      city: identity.city ?? team.city,
      name: identity.name ?? team.name,
      logoUrl: identity.logoUrl ?? team.logoUrl
    }))
    .filter(
      (identity, index, all) =>
        all.findIndex(
          (candidate) =>
            candidate.city === identity.city &&
            candidate.name === identity.name &&
            candidate.logoUrl === identity.logoUrl
        ) === index
    );

  const namesMatch = identities.every((identity) => identity.name === identities[0]?.name);
  const label = namesMatch
    ? `${identities.map((identity) => identity.city).join(" / ")} ${identities[0]?.name ?? team.name}`
    : identities.map((identity) => `${identity.city} ${identity.name}`).join(" / ");
  const logoUrls = identities
    .map((identity) => identity.logoUrl)
    .filter((logoUrl, index, all) => all.indexOf(logoUrl) === index);

  return {
    label,
    logoUrls: logoUrls.length > 0 ? logoUrls : [team.logoUrl],
    primary: team.primary,
    secondary: team.secondary
  };
}
