@sizing-review-needed
Feature: The table saves only the deposit it replays
  A signing carries its game's record: the controls held at each step, from the start to the game over. The table plays
  the game again from the seed its session sealed, and saves the deposit only when the replay ends at game over exactly
  where the record ends, on the deposit claimed. Anything else is refused, and nothing is saved.

  @US-03 @D1 @DDD-R9 @DDD-R14 @driving_port @server @real-io @kpi-K21
  Scenario: An honest game's deposit is the deposit the table saves
    Given the high-score table holds these signatures:
      | initials | deposit | signed at |
      | KIM      | £2,000  | 08:00     |
      | LEO      | £1,500  | 08:10     |
      | TED      | £1,000  | 08:20     |
    When Alex's game signs ALX with £1,250, carrying its session
    Then the signature is saved as one new row
    And the answer shows ALX's new row at #3
    And the owner can see the game was replayed, and how long the replay took

  @US-03 @D1 @DDD-R9 @DDD-R14 @server @real-io @error @kpi-K20
  Scenario Outline: A deposit the game didn't play to is refused: <claimed> for a game played to <played>
    Given the high-score table holds KIM with £2,000
    When HAX's game, played to <played>, signs HAX with <claimed>
    Then the signature is refused as not the game it claims
    And the owner can see why it was refused
    And the owner can see the game was replayed, and how long the replay took
    And what the owner sees says nothing about the player
    And the table is left as it was

    Examples:
      | played | claimed  |
      | £350   | £249,950 |
      | £1,250 | £1,300   |
      | £1,250 | £1,200   |

  @pending @US-03 @D1 @DDD-R9 @server @real-io @error @kpi-K20
  Scenario: A record made up by hand is refused, whatever it claims
    Given the high-score table holds KIM with £2,000
    When HAX signs with £249,950, carrying a session issued over 30 seconds before, and a made-up record of 30 seconds standing still
    Then the signature is refused as not the game it claims
    And the owner can see the game was replayed, and how long the replay took
    And the table is left as it was

  @pending @US-03 @D1 @DDD-R9 @server @real-io @error @kpi-K20
  Scenario Outline: A record that <twist> is refused
    Given the high-score table holds KIM with £2,000
    When Alex's game signs ALX with £1,250, carrying its session and a record that <twist>
    Then the signature is refused as not the game it claims
    And the owner can see the game was replayed, and how long the replay took
    And the table is left as it was

    Examples:
      | twist                              |
      | stops a step before its game over  |
      | goes on a step after its game over |

  @pending @US-03 @DDD-R5 @DDD-R14 @server @real-io @error @kpi-K20
  Scenario Outline: A record whose <fault> is refused before any replay
    Given the high-score table holds KIM with £2,000
    When Alex's game signs ALX with £1,250, carrying its session and a record whose <fault>
    Then the signature is refused as carrying something that isn't a record
    And the owner can see why it was refused
    And the owner can see the game was never replayed
    And the table is left as it was

    Examples:
      | fault                                         |
      | controls aren't written down as text          |
      | controls name a key the game doesn't have     |
      | changes come twice at the same moment         |
      | first change comes after the game's start     |
      | last change comes at or after the end it gives |
      | rules aren't named                            |
      | length is nothing at all                      |

  # The ceiling (£500,000 from slice 02, D14) is checked on the claim, so a refusal there costs no replay.
  @US-03 @US-04 @D14 @DDD-R16 @server @real-io @error @edge @kpi-K20
  Scenario Outline: The ceiling is checked on the claim, before any replay: <claimed> for a game played to £1,250
    Given the high-score table holds KIM with £2,000
    When Alex's game, played to £1,250, signs ALX with <claimed>
    Then the signature is refused <why>
    And the owner can see the game was <replayed>
    And the table is left as it was

    Examples:
      | claimed  | why                       | replayed                               |
      | £500,000 | as not the game it claims | replayed, and how long the replay took |
      | £500,050 | as implausible            | never replayed                         |
