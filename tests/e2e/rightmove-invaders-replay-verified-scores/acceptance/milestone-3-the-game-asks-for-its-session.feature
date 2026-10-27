@sizing-review-needed
Feature: Every game gets its session as it starts, without waiting
  The game asks the table for its session in the background as it starts, and the answer also refreshes the table.
  Nothing on screen waits for it. A signing carries the session of the game it signs. A game whose session never came
  plays as usual, is still asked for initials, and its signing can't be confirmed (D11).

  # After slice 02 the local function also replays this game, played with the keyboard, and saves the deposit the
  # game showed (K21): every browser signing in the suite is replayed the same way. DISCUSS's example is Alex's £1,250
  # at #3; the browser player can only score £0 or £50 (one shot at the Damp), so the table is arranged around £50.
  # The pending line is announced before the outcome, and the live-region recorder keeps both.
  @US-02 @US-03 @D2 @DDD-R10 @driving_port @real-io @kpi-K21
  Scenario: Typed initials sign the table through the game's own session
    Given the high-score table holds 3 signatures of £1,000
    And my deposit of £50 makes the high-score table
    When I sign the table as ALX
    Then the game tells me "Signing ALX…"
    And the game tells me "Signed ALX, #4."
    And ALX's row on the high-score table is marked as mine
    And my signing carried the session the table gave this game
    And the high-score table everyone reads has ALX with £50

  # Not @pending: today's game asks for no session, so it starts at once; the session request DELIVER adds must not
  # change that (a guard, as in the leaderboard's suite).
  @US-02 @D2 @DDD-R10 @real-io @edge @kpi-K25
  Scenario Outline: The game starts at once while the table answers its session request <how>
    Given I have opened the game
    And the table will answer my next game's session request <how>
    When I start a game and fire my first shot straight away
    Then a new game starts
    And my first shot scores £50 within a second

    Examples:
      | how             |
      | at once         |
      | 3 seconds later |
      | with a failure  |
      | never           |

  @US-02 @D2 @D19 @DDD-R10 @real-io
  Scenario: Starting a game asks the table's server once, and its answer refreshes the table
    Given the high-score table holds 9 signatures of £1,000
    And I have opened the game
    And another house-hunter has since signed with £1,000
    When I finish a game with a deposit of £50
    Then the game asked the table's server once for that game, for its session
    And I am not asked for my initials
    And the high-score table is shown with 10 rows

  # The table loaded with the page, so the deposit is still asked for initials. A signing waits for a session still on
  # its way, but no game here can end inside the session's 5 s timeout (a game lasts 10 s or more), so these are the
  # two outcomes a player can meet; the wait itself is DELIVER's test of the table client (DISTILL, Upstream findings).
  @pending @US-02 @D11 @DDD-R10 @real-io @error
  Scenario Outline: A game whose session request <trouble> plays as usual, and its signing can't be confirmed
    Given the high-score table holds 3 signatures of £1,000
    And the table <trouble> when my next game asks for its session
    And my deposit of £50 makes the high-score table
    When I sign the table as ALX
    Then the game tells me "Couldn't confirm ALX's signing."
    And no row on the high-score table is marked as mine
    And the game never sent my signing
    And the high-score table everyone reads has no row for ALX

    Examples:
      | trouble          |
      | can't be reached |
      | never answers    |

  # Each page draws its games' seeds from luck of its own, so two pages on one board play two games (DESIGN, Open
  # questions 1). Not @pending: it passes today, and one row per game must not refuse the second (a guard).
  @US-02 @D7 @DDD-R4 @DDD-R15 @real-io @edge
  Scenario: Two house-hunters on one table each sign a game of their own
    Given the high-score table holds 3 signatures of £1,000
    And another house-hunter has signed a game of their own as BEA on their own computer
    And my deposit of £50 makes the high-score table
    When I sign the table as ALX
    Then the game tells me "Signed ALX, #5."
    And the high-score table everyone reads has BEA with £50
    And the high-score table everyone reads has ALX with £50
