Feature: Refused initials start again empty (US-04)
  Initials on the word filter are refused in the game, before anything is sent. The entry empties and says why, and the
  next initials I type sign as usual.

  # "Initials on the word filter" are the first entry of the shared word list (src/game/high-scores.js), typed in
  # lowercase. The scenarios don't spell the word, as the leaderboard's don't. UAT 3's Up row (a key the entry ignores
  # leaves the refusal showing) shows on the canvas only, so it is checked on the rules (milestone 6) and by hand.

  @US-04 @slice-01 @real-io @error @contract-shape:bounded-change @DDD-T6
  Scenario: Refused initials are cleared
    Given my deposit of £50 makes the high-score table
    And I have typed initials on the word filter
    When I press Enter
    Then the game tells me "Those initials aren't allowed. Type different ones."
    And the initials field shows "No letters yet, letter 1 of 3"
    And nothing is sent to the high-score table

  @US-04 @slice-01 @kpi @kpi-K16 @real-io @contract-shape:bounded-change
  Scenario: Other initials sign after a refusal
    Given my deposit of £50 makes the high-score table
    And my initials on the word filter have just been refused
    And I have typed "sam"
    When I press Enter
    Then the game tells me "Signing SAM…"

  @US-04 @slice-01 @real-io @edge @contract-shape:bounded-change @DDD-T6
  Scenario: The refusal is over with the next letter
    Given my deposit of £50 makes the high-score table
    And my initials on the word filter have just been refused
    When I type "s"
    Then the initials field shows "S, letter 2 of 3"
    And the game doesn't repeat the refusal

  @US-04 @slice-01 @real-io @error @contract-shape:bounded-change @DDD-T6
  Scenario: Enter straight after a refusal sends nothing
    Given my deposit of £50 makes the high-score table
    And my initials on the word filter have just been refused
    When I press Enter
    Then the game tells me "Type 3 letters to sign"
    And nothing is sent to the high-score table
