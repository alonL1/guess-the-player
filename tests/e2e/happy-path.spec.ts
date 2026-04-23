import { expect, test } from "@playwright/test";

import { starterCatalog } from "../../src/lib/data/starter-catalog";
import { formatTeamLabel } from "../../src/lib/nfl-teams";

test("host and guest can finish a one-round match and return to the lobby", async ({ browser, page }) => {
  await page.goto("/");
  await page.getByRole("textbox", { name: "Nickname" }).fill("Host Alpha");
  await page.getByRole("button", { name: "Create Room" }).click();

  await expect(page).toHaveURL(/\/rooms\/[A-Z0-9]+$/);
  const roomUrl = page.url();

  const guestContext = await browser.newContext();
  const guestPage = await guestContext.newPage();
  await guestPage.goto(roomUrl);
  await guestPage.getByRole("textbox", { name: "Nickname" }).fill("Guest Beta");
  await guestPage.getByRole("button", { name: "Join Room" }).click();

  await expect(page.getByText("2/8 players")).toBeVisible();

  const roundsInput = page.getByRole("spinbutton", { name: "Rounds" });
  await roundsInput.fill("1");
  await page.getByRole("button", { name: "Start Game" }).click();

  await expect(page.getByText("Guess the hidden NFL player.")).toBeVisible({ timeout: 10000 });

  const timelineLabels = await page.locator("article h3").allTextContents();
  const answer = starterCatalog.find((player) => {
    const sequence = player.teamStints.map((stint) => formatTeamLabel(stint.teamId));
    return sequence.join("|") === timelineLabels.join("|");
  });

  expect(answer).toBeTruthy();

  await page.getByPlaceholder("Search player names").fill(answer!.fullName);
  await page.getByRole("button", { name: answer!.fullName }).click();

  await guestPage.getByPlaceholder("Search player names").fill(answer!.fullName);
  await guestPage.getByRole("button", { name: answer!.fullName }).click();

  await expect(page.getByText(answer!.fullName)).toBeVisible({ timeout: 10000 });
  await page.getByRole("button", { name: "Continue to Leaderboard" }).click();
  await expect(page.getByText("Match complete.")).toBeVisible({ timeout: 10000 });
  await page.getByRole("button", { name: "Back to Lobby" }).click();
  await expect(page.getByText("Set the match.")).toBeVisible({ timeout: 10000 });

  await guestContext.close();
});
