import { describe, expect, it } from "vitest";

import {
  calculateCurrentCap,
  calculateKahootScoreWithTimer,
  calculateKahootScoreWithoutTimer,
  calculateScore
} from "@/lib/game/scoring";

describe("scoring", () => {
  it("reduces the maximum attainable score with wrong guesses down to a floor", () => {
    expect(calculateCurrentCap(0)).toBe(1000);
    expect(calculateCurrentCap(2)).toBe(700);
    expect(calculateCurrentCap(8)).toBe(250);
  });

  it("scores timer rounds based on remaining fraction", () => {
    expect(
      calculateKahootScoreWithTimer({
        wrongGuessCount: 1,
        remainingTimeFraction: 0.5
      })
    ).toBe(425);
  });

  it("scores no-timer rounds based on answer rank with a floor", () => {
    expect(
      calculateKahootScoreWithoutTimer({
        wrongGuessCount: 0,
        correctOrder: 1
      })
    ).toBe(1000);

    expect(
      calculateKahootScoreWithoutTimer({
        wrongGuessCount: 2,
        correctOrder: 4
      })
    ).toBe(490);

    expect(
      calculateKahootScoreWithoutTimer({
        wrongGuessCount: 5,
        correctOrder: 20
      })
    ).toBe(75);
  });

  it("returns a full 1000 in sudden death", () => {
    expect(
      calculateScore({
        mode: "sudden_death",
        wrongGuessCount: 4
      })
    ).toBe(1000);
  });
});
