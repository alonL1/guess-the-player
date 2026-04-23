import type { GameMode } from "@/lib/types";
import { clamp } from "@/lib/utils";

export function calculateCurrentCap(wrongGuessCount: number) {
  return Math.max(250, 1000 - wrongGuessCount * 150);
}

export function calculateKahootScoreWithTimer(params: {
  wrongGuessCount: number;
  remainingTimeFraction: number;
}) {
  const cap = calculateCurrentCap(params.wrongGuessCount);
  return Math.round(cap * clamp(params.remainingTimeFraction, 0, 1));
}

export function calculateKahootScoreWithoutTimer(params: {
  wrongGuessCount: number;
  correctOrder: number;
}) {
  const cap = calculateCurrentCap(params.wrongGuessCount);
  const rankMultiplier = Math.max(0.3, 1 - (params.correctOrder - 1) * 0.1);
  return Math.round(cap * rankMultiplier);
}

export function calculateScore(params: {
  mode: GameMode;
  wrongGuessCount: number;
  remainingTimeFraction?: number;
  correctOrder?: number;
}) {
  if (params.mode === "sudden_death") {
    return 1000;
  }

  if (typeof params.remainingTimeFraction === "number") {
    return calculateKahootScoreWithTimer({
      wrongGuessCount: params.wrongGuessCount,
      remainingTimeFraction: params.remainingTimeFraction
    });
  }

  return calculateKahootScoreWithoutTimer({
    wrongGuessCount: params.wrongGuessCount,
    correctOrder: params.correctOrder ?? 1
  });
}
