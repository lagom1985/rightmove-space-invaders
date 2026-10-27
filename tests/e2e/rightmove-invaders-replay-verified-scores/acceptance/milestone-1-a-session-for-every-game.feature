@sizing-review-needed
Feature: The table issues a session for every game
  As a game starts, it sends the table its seed, and gets back its session: the seed and the moment the table issued
  it, sealed by the table, together with the table as it now stands. The table issues no session without its rows, and
  none at all without its secret.

  @US-02 @D2 @D3 @DDD-R1 @DDD-R2 @DDD-R14 @driving_port @server @real-io @kpi-K25
  Scenario: A game that starts gets its session and the table, in one answer
    Given the high-score table holds KIM with £2,000
    When a game asks the high-score table for a session for its seed
    Then the answer carries a session for that seed, issued now
    And the high-score table answers with these rows, in order:
      | initials | deposit |
      | KIM      | £2,000  |
    And the answer says when the table was looked at
    And the answer is never kept for reuse
    And the owner can see a session was issued, and how long it took
    And what the owner sees says nothing about the player

  @US-02 @DDD-R1 @DDD-R14 @server @real-io @error
  Scenario Outline: A request for a session with <what> is refused <why>, and no session is issued
    Given nobody has signed the high-score table yet
    When a game asks the high-score table for a session with <what>
    Then the session request is refused <why>
    And no session is issued
    And the owner can see why it was refused

    Examples:
      | what                                  | why            |
      | its seed in capitals                  | as not a seed  |
      | a seed one character short            | as not a seed  |
      | no seed at all                        | as not a seed  |
      | its seed and a note                   | as not a seed  |
      | something that isn't a request at all | as not a seed  |
      | its seed sent in the wrong format     | for its format |
      | its seed stretched past 1 KB          | as too long    |

  @US-02 @DDD-R1 @DDD-R14 @server @real-io @error
  Scenario: Asking for a session any other way is refused, because a session can only be asked for
    Given nobody has signed the high-score table yet
    When someone reads the sessions instead of asking for one
    Then the request is refused, because a session can only be asked for
    And no session is issued
    And the owner can see why it was refused

  @US-02 @DDD-R1 @DDD-R14 @server @real-io @error
  Scenario: When the table can't be looked at, no session is issued without it
    Given the high-score table holds KIM with £2,000
    And looking at the high-score table fails
    When a game asks the high-score table for a session for its seed
    Then the answer is that the table failed unexpectedly
    And no session is issued
    And the owner can see it was a failed look at the table
    And what the owner sees says nothing about the player

  @US-01 @D3 @DDD-R2 @DDD-R14 @server @real-io @error
  Scenario: Without its secret, the table issues no session, and the owner is told why
    Given the high-score table has no secret
    When a game asks the high-score table for a session for its seed
    Then the answer is that the table failed unexpectedly
    And no session is issued
    And the owner can see the table has no secret
    And what the owner sees says nothing about the player

  @US-01 @D3 @DDD-R2 @DDD-R14 @server @real-io @error
  Scenario: Without its secret, the table saves no signing, and the owner is told why
    Given the high-score table holds KIM with £2,000
    And Alex's game has been given a session, and the table has since lost its secret
    When Alex's game signs ALX with £1,250, carrying its session
    Then the answer is that the table failed unexpectedly
    And the owner can see the table has no secret
    And what the owner sees says nothing about the player
    And the table is left as it was
