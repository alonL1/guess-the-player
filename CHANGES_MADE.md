# Changes Made

This file summarizes the main changes made during the buildout of NFL Path Guesser.

## Deployment

- Set up the app to run with a Cloudflare Pages frontend and a PartyKit realtime backend.
- Confirmed the deployed PartyKit room server at `https://nfl-path-guesser.alonl1.partykit.dev`.
- Confirmed Cloudflare Pages deploys from GitHub pushes.

## Player Catalog

- Replaced the small static player pool with a generated NFL player catalog.
- Expanded catalog generation to pull nflverse roster data back to 1970.
- Kept gameplay limited to players with more than one NFL team stint.
- Added offensive, defensive, kicker, punter, and return/special-teams support.
- Added fallback prominence logic for pre-1999 players and punters, since full stat files are not available for every older season or punting volume.
- Regenerated the catalog to about 6,000 eligible multi-team players.
- Added a localhost-only player inspector at `/catalog` for checking a player’s teams, years, position, difficulty, and status.

## Difficulty Tuning

- Reworked difficulty scoring so the player pool is easier overall.
- Added recency as a difficulty factor so current and recent players are generally easier.
- Added a defensive-player difficulty bump.
- Added special-team/kicker/punter-specific difficulty handling.
- Tuned older legends so players like Brett Favre and Joe Montana are not buried in hard/impossible because of missing pre-1999 stats.
- Tightened the easy tier so it stays reserved for broadly recognizable players.
- Made kicker difficulty more selective, with no easy kickers and a smaller medium kicker group.

## Solo Mode

- Added Quick Solo Play at `/solo`.
- Added local-only solo gameplay with no PartyKit connection.
- Added solo settings for rounds, timer, scoring, difficulties, years, position hint, year filter, and team filter.
- Added solo scoring for Time Based and Sudden Death modes.
- Added solo round states: setup, countdown, active, reveal, and summary.
- Added balanced player selection by selected difficulty so mixed difficulties do not randomly overrepresent one bucket.

## Room Mode

- Renamed the room setting from Mode to Scoring.
- Renamed scoring options to Time Based and Sudden Death.
- Added team logos to team path cards.
- Made years visible by default.
- Added optional position hint, disabled by default.
- Added balanced player deck selection by difficulty for room games.
- Added room setting pool count so hosts can see how many eligible players match the current filters.
- Added an in-app warning popup when a host tries to start with fewer eligible players than rounds.

## Year and Team Filters

- Replaced Current Players Only with a more flexible Career years area.
- Added a two-thumb year range slider with a filled selected range.
- Added a dropdown for how the year range is interpreted:
  - Year Entering League
  - Year Retired
  - Full Career
  - Current Players Only
- Hid the slider when Current Players Only is selected.
- Added a Reset button that restores the year filter defaults.
- Set the default year filter to Full Career, 1999 to Current.
- Added team selection as a dropdown.
- Applied the same filters consistently to solo play, room play, search results, and PartyKit backend validation.

## Landing Page

- Simplified the landing page so content sits directly on the background instead of inside a large white panel.
- Kept and enlarged the NFL Path Guesser title.
- Added the subtitle: “Guess the player from the career path”.
- Added a prominent Quick Solo Play button.
- Added a Compete with friends section with nickname, Create Room, and Join a Room controls.
- Changed Join a Room to open a popup with:
  - Find Me a Room
  - Join With a Room Code
- Added room-code validation so joining by code only continues for a valid, currently open room.

## Search UI

- Updated player search results in solo and room games to show player headshots next to names.
- Added position labels under search result names.
- Kept search results filtered by the current year/team/difficulty settings.

