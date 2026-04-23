import { describe, expect, it } from "vitest";

import { starterCatalog } from "@/lib/data/starter-catalog";
import { formatYearRange } from "@/lib/utils";

describe("team timeline helpers", () => {
  it("keeps repeated stints as separate timeline entries", () => {
    const jimmyGraham = starterCatalog.find((player) => player.id === "jimmy-graham");
    expect(jimmyGraham).toBeTruthy();
    expect(jimmyGraham?.teamStints.length).toBe(5);
    expect(jimmyGraham?.teamStints[0].teamId).toBe("NO");
    expect(jimmyGraham?.teamStints.at(-1)?.teamId).toBe("NO");
  });

  it("formats active stints with Current", () => {
    expect(formatYearRange(2024, null)).toBe("2024 - Current");
  });
});
