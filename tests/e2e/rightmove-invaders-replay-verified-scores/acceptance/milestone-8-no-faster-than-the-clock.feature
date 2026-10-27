@sizing-review-needed
Feature: No game signs faster than it could have been played
  The table knows when it sealed a game's session, and reads the game's length from its record. A game can't be signed
  sooner after its session than it lasted, give or take the 10 seconds a session may take to arrive (D8). A game
  computed in seconds must still wait its own length; an honest game never notices, and the browser's clock plays no
  part. The local server lets the browser scenarios, which play on a fast fake clock, through this check (E6); the
  scenarios here never ask it to.

  # The local server's lenient clock is its own: the table, as the function runs it, ignores the cookie (E6).
  @pending @US-05 @D8 @DDD-R11 @E6 @server @real-io @error @kpi-K20
  Scenario: A game signed sooner than it lasted is refused, even when the request asks for the local server's lenient clock
    Given the high-score table holds KIM with £2,000
    When Alex's game signs ALX with £1,250 a second after its session was issued, asking for the lenient clock
    Then the signature is refused as faster than the clock
    And the table is left as it was

  @pending @US-05 @D8 @DDD-R11 @DDD-R14 @server @real-io @error @kpi-K20
  Scenario: A 20-minute game signed a minute after its session is refused
    Given the high-score table holds KIM with £2,000
    When HAX signs with £80,000 and a made-up record of 20 minutes, a minute after its session was issued
    Then the signature is refused as faster than the clock
    And the owner can see why it was refused
    And the owner can see the game was never replayed
    And the table is left as it was

  # A game whose length is a whole number of milliseconds, so the boundary is exact (DISTILL, Clarifications).
  @pending @US-05 @D8 @DDD-R11 @server @real-io @edge @kpi-K20
  Scenario Outline: Signed as long after its session as the game lasted, less <margin>, a game is <what happens>
    Given the high-score table holds KIM with £2,000
    When Alex's game signs ALX with £1,250, as long after its session was issued as the game lasted, less <margin>
    Then <outcome>

    Examples:
      | margin     | what happens | outcome                                              |
      | 10 seconds | saved        | the signature is saved as one new row                |
      | 11 seconds | refused      | the signature is refused as faster than the clock    |

  @pending @US-05 @D8 @DDD-R11 @server @real-io @edge @kpi-K23
  Scenario Outline: An honest game is never too fast: <pace>
    Given the high-score table holds KIM with £2,000
    When Alex's game, <pace>, signs ALX with £1,250
    Then the signature is saved as one new row

    Examples:
      | pace                                                                       |
      | signed a second after its game over                                        |
      | given its session 4 seconds after it started and signed at its game over   |
      | paused for 10 minutes and signed a second after its game over              |

  # A game played in real time, with no help from the local server: the one browser scenario that meets the clock check.
  # Not @pending: an honest game signs today, and the clock check of slice 03 must not change that (a guard). It plays a
  # whole game in real time, about 30-50 s in each engine.
  @US-05 @D8 @DDD-R10 @real-io @edge @kpi-K23
  Scenario Outline: The browser's clock plays no part: a computer <error>
    Given the high-score table holds 3 signatures of £1,000
    And my computer's clock is <error>
    When I play a game in real time to a deposit of £50, and sign it as ALX
    Then the game tells me "Signed ALX, #4."

    Examples:
      | error        |
      | an hour fast |
      | an hour slow |
