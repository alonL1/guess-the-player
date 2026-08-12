import { ACTIVE_SPORT } from "@/lib/sports";
import type { TeamStint } from "@/lib/types";

type ResolvedIdentity = {
  city: string;
  name: string;
  logoUrl: string;
};

export function getTeamStintDisplay(stint: TeamStint) {
  const team = ACTIVE_SPORT.teams[stint.teamId];
  if (!team) {
    return {
      label: stint.teamId,
      logoUrls: [] as string[],
      primary: "#ffffff",
      secondary: "#111111"
    };
  }
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
  const cities = identities
    .flatMap((identity) => identity.city.split("/").map((city) => city.trim()))
    .filter((city, index, all) => city && all.indexOf(city) === index);
  const label = namesMatch
    ? `${cities.join(" / ")} ${identities[0]?.name ?? team.name}`
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
