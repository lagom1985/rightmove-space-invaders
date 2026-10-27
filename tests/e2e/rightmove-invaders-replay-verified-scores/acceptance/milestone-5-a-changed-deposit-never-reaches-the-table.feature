Feature: A deposit changed in the browser never reaches the table
  Whatever a house-hunter changes in their own browser, the table saves only the deposit the game really played to.
  The console can't reach the game in play, and a deposit changed on its way to the table is refused, which the game
  reports as it reports any refusal: the signing couldn't be confirmed (D5).

  # The 2026-10-26 forgery from the console (the RCA's Vector B), once the console can't reach the game: the same change
  # made to what the page sends, as a forger with the browser's tools would make it.
  @pending @US-03 @D1 @D5 @DDD-R9 @real-io @error @kpi-K20
  Scenario: A deposit changed on its way to the table is refused, and the game can't confirm the signing
    Given the high-score table holds 3 signatures of £1,000
    And my deposit of £50 makes the high-score table
    And a forger changes the deposit my game sends to £249,950
    When I sign the table as HAX
    Then the game tells me "Couldn't confirm HAX's signing."
    And no row on the high-score table is marked as mine
    And the high-score table everyone reads has no row for HAX

  # Defence in depth (ADR-013): the page's modules expose no game in play.
  @pending @US-03 @D1 @DDD-R7 @real-io @error
  Scenario: The console line of the 2026-10-26 forgery can't reach the game in play
    Given I have opened the game
    And I have started a new game
    When a forger runs the console line that set the deposit on 2026-10-26
    Then the console loaded the game's code, but found no game in play in it
    And the game still shows a deposit of £0
