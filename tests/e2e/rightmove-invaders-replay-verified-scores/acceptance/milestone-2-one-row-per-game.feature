@sizing-review-needed
Feature: Only a game the table sealed can sign it, and only once
  A signing carries the session its game was given. The table turns away a session it didn't seal, one more than two
  hours old, and a second signing for a game whose row is on the table, and saves nothing for any of them. A refused
  attempt doesn't use the session up, and a game whose row has left the table may sign again while its session lasts
  (D7, D16: accepted by the user).

  @US-01 @D6 @DDD-R2 @DDD-R14 @server @real-io @error @kpi-K20
  Scenario Outline: A session the table didn't seal is refused: <carrying>
    Given the high-score table holds KIM with £2,000
    And Alex's game has been given a session
    When Alex's game signs ALX with £1,250, carrying <carrying>
    Then the signature is refused as carrying a session the table didn't seal
    And the owner can see why it was refused
    And what the owner sees says nothing about the player
    And the table is left as it was

    Examples:
      | carrying                                             |
      | its session with the issue time moved an hour earlier |
      | its session with another game's seed put in it        |
      | its session with one character of its seal changed    |
      | its session with its seal cut short                   |
      | a session made up from nothing                        |
      | something that isn't a session at all                |

  @US-01 @D7 @DDD-R4 @DDD-R14 @server @real-io @error @kpi-K20
  Scenario Outline: A game has one row on the table: signing it again with <carrying> is refused
    Given the high-score table holds KIM with £2,000
    And Alex's game has signed ALX with £1,250
    When Alex's game signs XAH with £1,250, carrying <carrying>
    Then the signature is refused as a game that has already signed
    And the owner can see why it was refused
    And what the owner sees says nothing about the player
    And a reading of the table taken while it was being refused shows ALX with £1,250 once, and no row for XAH
    And the high-score table now shows ALX with £1,250 once, and no row for XAH
    And the table is left as it was

    Examples:
      | carrying                          |
      | the session it signed with        |
      | another session for the same game |

  # The race only a forger runs. The answers and the readings are what anyone sees; the store itself may hold a game's
  # other keys for a moment, which the ranking never shows and pruning removes first (DDD-R4). Signings that all arrive
  # together may all be refused, leaving no row (DDD-R4 allows it); one that arrives just ahead keeps its row.
  @US-01 @D7 @DDD-R4 @server @real-io @property @error @kpi-K20
  Scenario: However many signings of one game arrive at once, nobody ever sees two rows for it
    Given nobody has signed the high-score table yet
    When any burst of 2 to 5 signings of one game arrives, all at once or just after a first one, while the table is being read
    Then no answer and no reading ever shows more than one row for that game
    And a signing that arrived just ahead of the others kept its row

  @US-01 @D7 @DDD-R4 @server @real-io @error @edge
  Scenario: A refused attempt doesn't use up the session
    Given the high-score table holds KIM with £2,000
    And Alex's game tried to sign ALX with £1,250, but saving to the high-score table failed
    When Alex's game signs ALX with £1,250, carrying its session
    Then the signature is saved as one new row
    And the answer shows ALX's new row at #2
    And what the owner sees says nothing about the player

  # ADR-008's saved-but-unconfirmed case: the row was saved, so the game has signed.
  @US-01 @D7 @DDD-R4 @server @real-io @error @edge
  Scenario: A game saved just before the table couldn't be looked at has signed, though nobody was told
    Given the high-score table holds KIM with £2,000
    And Alex's game has signed ALX with £1,250, saved just before the table couldn't be looked at
    When Alex's game signs ALX with £1,250, carrying its session
    Then the signature is refused as a game that has already signed
    And the owner can see why it was refused
    And what the owner sees says nothing about the player
    And the high-score table now shows ALX with £1,250 once

  @US-01 @D7 @D16 @D18 @DDD-R2 @DDD-R4 @server @real-io @error @edge @kpi-K20
  Scenario Outline: A session lasts 2 hours: <history>, then signed with a session issued <when>
    Given the high-score table holds KIM with £2,000
    And Alex's game has <history>
    When Alex's game signs ALX with £1,250, its session issued <when>
    Then <outcome>
    And what the owner sees says nothing about the player

    Examples: Within its 2 hours, a game that hasn't a row on the table signs, even one whose row has left it
      | history                                                                  | when                    | outcome                               |
      | been given a session                                                     | 1 hour 59 minutes ago   | the signature is saved as one new row |
      | signed ALX with £1,250, and the owner has since deleted its row          | 1 hour 59 minutes ago   | the signature is saved as one new row |
      | signed ALX with £1,250 behind 20 better scores, was pruned, and the owner has since deleted one of them | 1 hour 59 minutes ago | the signature is saved as one new row |

    Examples: Older than 2 hours, or from the future, the session is no good
      | history              | when                    | outcome                                                              |
      | been given a session | 2 hours 1 minute ago    | the signature is refused as carrying an expired session              |
      | been given a session | 11 seconds from now     | the signature is refused as carrying a session the table didn't seal |
