import type { Difficulty, PlayerCatalogEntry, TeamStint } from "@/lib/types";
import { createSlug, createUiAvatarUrl, normalizeSearchText } from "@/lib/utils";

type StarterPlayer = {
  fullName: string;
  difficulty: Difficulty;
  teamStints: TeamStint[];
  headshotUrl?: string;
};

const STARTER_PLAYERS: StarterPlayer[] = [
  { fullName: "Tom Brady", difficulty: "easy", teamStints: [{ teamId: "NE", startYear: 2000, endYear: 2019 }, { teamId: "TB", startYear: 2020, endYear: 2022 }] },
  { fullName: "Peyton Manning", difficulty: "easy", teamStints: [{ teamId: "IND", startYear: 1998, endYear: 2011 }, { teamId: "DEN", startYear: 2012, endYear: 2015 }] },
  { fullName: "Brett Favre", difficulty: "easy", teamStints: [{ teamId: "ATL", startYear: 1991, endYear: 1991 }, { teamId: "GB", startYear: 1992, endYear: 2007 }, { teamId: "NYJ", startYear: 2008, endYear: 2008 }, { teamId: "MIN", startYear: 2009, endYear: 2010 }] },
  { fullName: "Randy Moss", difficulty: "easy", teamStints: [{ teamId: "MIN", startYear: 1998, endYear: 2004 }, { teamId: "LV", startYear: 2005, endYear: 2006 }, { teamId: "NE", startYear: 2007, endYear: 2010 }, { teamId: "TEN", startYear: 2010, endYear: 2010 }, { teamId: "SF", startYear: 2012, endYear: 2012 }] },
  { fullName: "Terrell Owens", difficulty: "easy", teamStints: [{ teamId: "SF", startYear: 1996, endYear: 2003 }, { teamId: "PHI", startYear: 2004, endYear: 2005 }, { teamId: "DAL", startYear: 2006, endYear: 2008 }, { teamId: "BUF", startYear: 2009, endYear: 2009 }, { teamId: "CIN", startYear: 2010, endYear: 2010 }] },
  { fullName: "Adrian Peterson", difficulty: "easy", teamStints: [{ teamId: "MIN", startYear: 2007, endYear: 2016 }, { teamId: "NO", startYear: 2017, endYear: 2017 }, { teamId: "ARI", startYear: 2017, endYear: 2017 }, { teamId: "WAS", startYear: 2018, endYear: 2019 }, { teamId: "DET", startYear: 2020, endYear: 2020 }, { teamId: "TEN", startYear: 2021, endYear: 2021 }, { teamId: "SEA", startYear: 2021, endYear: 2021 }] },
  { fullName: "Saquon Barkley", difficulty: "easy", teamStints: [{ teamId: "NYG", startYear: 2018, endYear: 2023 }, { teamId: "PHI", startYear: 2024, endYear: null }] },
  { fullName: "Matthew Stafford", difficulty: "easy", teamStints: [{ teamId: "DET", startYear: 2009, endYear: 2020 }, { teamId: "LAR", startYear: 2021, endYear: null }] },
  { fullName: "Aaron Rodgers", difficulty: "easy", teamStints: [{ teamId: "GB", startYear: 2005, endYear: 2022 }, { teamId: "NYJ", startYear: 2023, endYear: null }] },
  { fullName: "Julio Jones", difficulty: "easy", teamStints: [{ teamId: "ATL", startYear: 2011, endYear: 2020 }, { teamId: "TEN", startYear: 2021, endYear: 2021 }, { teamId: "TB", startYear: 2022, endYear: 2022 }, { teamId: "PHI", startYear: 2023, endYear: 2023 }] },
  { fullName: "Russell Wilson", difficulty: "medium", teamStints: [{ teamId: "SEA", startYear: 2012, endYear: 2021 }, { teamId: "DEN", startYear: 2022, endYear: 2023 }, { teamId: "PIT", startYear: 2024, endYear: null }] },
  { fullName: "Jared Goff", difficulty: "medium", teamStints: [{ teamId: "LAR", startYear: 2016, endYear: 2020 }, { teamId: "DET", startYear: 2021, endYear: null }] },
  { fullName: "Baker Mayfield", difficulty: "medium", teamStints: [{ teamId: "CLE", startYear: 2018, endYear: 2021 }, { teamId: "CAR", startYear: 2022, endYear: 2022 }, { teamId: "LAR", startYear: 2022, endYear: 2022 }, { teamId: "TB", startYear: 2023, endYear: null }] },
  { fullName: "Stefon Diggs", difficulty: "medium", teamStints: [{ teamId: "MIN", startYear: 2015, endYear: 2019 }, { teamId: "BUF", startYear: 2020, endYear: 2023 }, { teamId: "HOU", startYear: 2024, endYear: 2024 }, { teamId: "NE", startYear: 2025, endYear: null }] },
  { fullName: "DeAndre Hopkins", difficulty: "medium", teamStints: [{ teamId: "HOU", startYear: 2013, endYear: 2019 }, { teamId: "ARI", startYear: 2020, endYear: 2022 }, { teamId: "TEN", startYear: 2023, endYear: 2023 }, { teamId: "KC", startYear: 2024, endYear: null }] },
  { fullName: "Brandin Cooks", difficulty: "medium", teamStints: [{ teamId: "NO", startYear: 2014, endYear: 2016 }, { teamId: "NE", startYear: 2017, endYear: 2017 }, { teamId: "LAR", startYear: 2018, endYear: 2019 }, { teamId: "HOU", startYear: 2020, endYear: 2022 }, { teamId: "DAL", startYear: 2023, endYear: null }] },
  { fullName: "Amari Cooper", difficulty: "medium", teamStints: [{ teamId: "LV", startYear: 2015, endYear: 2018 }, { teamId: "DAL", startYear: 2018, endYear: 2021 }, { teamId: "CLE", startYear: 2022, endYear: 2024 }, { teamId: "BUF", startYear: 2024, endYear: null }] },
  { fullName: "Carson Wentz", difficulty: "medium", teamStints: [{ teamId: "PHI", startYear: 2016, endYear: 2020 }, { teamId: "IND", startYear: 2021, endYear: 2021 }, { teamId: "WAS", startYear: 2022, endYear: 2022 }, { teamId: "LAR", startYear: 2023, endYear: 2023 }, { teamId: "KC", startYear: 2024, endYear: null }] },
  { fullName: "Christian McCaffrey", difficulty: "medium", teamStints: [{ teamId: "CAR", startYear: 2017, endYear: 2022 }, { teamId: "SF", startYear: 2022, endYear: null }] },
  { fullName: "Odell Beckham Jr.", difficulty: "medium", teamStints: [{ teamId: "NYG", startYear: 2014, endYear: 2018 }, { teamId: "CLE", startYear: 2019, endYear: 2021 }, { teamId: "LAR", startYear: 2021, endYear: 2021 }, { teamId: "BAL", startYear: 2023, endYear: 2023 }, { teamId: "MIA", startYear: 2024, endYear: null }] },
  { fullName: "Alex Smith", difficulty: "hard", teamStints: [{ teamId: "SF", startYear: 2005, endYear: 2012 }, { teamId: "KC", startYear: 2013, endYear: 2017 }, { teamId: "WAS", startYear: 2018, endYear: 2020 }] },
  { fullName: "Jimmy Graham", difficulty: "hard", teamStints: [{ teamId: "NO", startYear: 2010, endYear: 2014 }, { teamId: "SEA", startYear: 2015, endYear: 2017 }, { teamId: "GB", startYear: 2018, endYear: 2019 }, { teamId: "CHI", startYear: 2020, endYear: 2021 }, { teamId: "NO", startYear: 2023, endYear: 2023 }] },
  { fullName: "Teddy Bridgewater", difficulty: "hard", teamStints: [{ teamId: "MIN", startYear: 2014, endYear: 2017 }, { teamId: "NO", startYear: 2018, endYear: 2019 }, { teamId: "CAR", startYear: 2020, endYear: 2020 }, { teamId: "DEN", startYear: 2021, endYear: 2021 }, { teamId: "MIA", startYear: 2022, endYear: 2023 }, { teamId: "DET", startYear: 2023, endYear: 2023 }] },
  { fullName: "Nick Foles", difficulty: "hard", teamStints: [{ teamId: "PHI", startYear: 2012, endYear: 2014 }, { teamId: "LAR", startYear: 2015, endYear: 2015 }, { teamId: "KC", startYear: 2016, endYear: 2016 }, { teamId: "PHI", startYear: 2017, endYear: 2018 }, { teamId: "JAX", startYear: 2019, endYear: 2019 }, { teamId: "CHI", startYear: 2020, endYear: 2021 }, { teamId: "IND", startYear: 2022, endYear: 2022 }] },
  { fullName: "Ryan Fitzpatrick", difficulty: "hard", teamStints: [{ teamId: "LAR", startYear: 2005, endYear: 2006 }, { teamId: "CIN", startYear: 2007, endYear: 2008 }, { teamId: "BUF", startYear: 2009, endYear: 2012 }, { teamId: "TEN", startYear: 2013, endYear: 2013 }, { teamId: "HOU", startYear: 2014, endYear: 2014 }, { teamId: "NYJ", startYear: 2015, endYear: 2016 }, { teamId: "TB", startYear: 2017, endYear: 2018 }, { teamId: "MIA", startYear: 2019, endYear: 2020 }, { teamId: "WAS", startYear: 2021, endYear: 2021 }] },
  { fullName: "Anquan Boldin", difficulty: "impossible", teamStints: [{ teamId: "ARI", startYear: 2003, endYear: 2009 }, { teamId: "BAL", startYear: 2010, endYear: 2012 }, { teamId: "SF", startYear: 2013, endYear: 2015 }, { teamId: "DET", startYear: 2016, endYear: 2016 }] },
  { fullName: "Percy Harvin", difficulty: "impossible", teamStints: [{ teamId: "MIN", startYear: 2009, endYear: 2012 }, { teamId: "SEA", startYear: 2013, endYear: 2014 }, { teamId: "NYJ", startYear: 2014, endYear: 2014 }, { teamId: "BUF", startYear: 2015, endYear: 2016 }] },
  { fullName: "Golden Tate", difficulty: "impossible", teamStints: [{ teamId: "SEA", startYear: 2010, endYear: 2013 }, { teamId: "DET", startYear: 2014, endYear: 2018 }, { teamId: "PHI", startYear: 2018, endYear: 2018 }, { teamId: "NYG", startYear: 2019, endYear: 2020 }, { teamId: "TEN", startYear: 2021, endYear: 2021 }] },
  { fullName: "Brandon Marshall", difficulty: "impossible", teamStints: [{ teamId: "DEN", startYear: 2006, endYear: 2009 }, { teamId: "MIA", startYear: 2010, endYear: 2011 }, { teamId: "CHI", startYear: 2012, endYear: 2014 }, { teamId: "NYJ", startYear: 2015, endYear: 2016 }, { teamId: "NYG", startYear: 2017, endYear: 2017 }, { teamId: "SEA", startYear: 2018, endYear: 2018 }] }
];

function countUniqueTeams(teamStints: TeamStint[]) {
  return new Set(teamStints.map((team) => team.teamId)).size;
}

export const starterCatalog: PlayerCatalogEntry[] = STARTER_PLAYERS.map((player) => ({
  id: createSlug(player.fullName),
  fullName: player.fullName,
  normalizedName: normalizeSearchText(player.fullName),
  difficulty: player.difficulty,
  headshotUrl: player.headshotUrl ?? createUiAvatarUrl(player.fullName),
  teamStints: player.teamStints,
  uniqueTeamCount: countUniqueTeams(player.teamStints)
})).filter((player) => player.uniqueTeamCount > 1);
