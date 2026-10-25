Feature: Reading the shared high-score table
  Everyone who opens the game reads the same table: the best ten signatures, best first. The high-score table answers
  every reader, even when it holds stray entries or can't be looked at, and never changes while it is read.

  @OUT-7 @DDD-6 @DDD-12 @DDD-17 @driving_port @server @real-io @kpi-K14
  Scenario: An empty high-score table is read as empty, and everyone sees it at most 15 seconds old
    Given nobody has signed the high-score table yet
    When someone reads the high-score table
    Then the high-score table answers with no rows
    And the answer says when the table was looked at
    And everyone who reads the table sees it at most 15 seconds old
    And the owner can see where the table is kept and how long the read took
    And the table is left as it was

  @OUT-7 @DDD-1 @server @real-io
  Scenario: The table shows the best ten signatures, best first, and the earlier of two equal deposits first
    Given the high-score table holds these signatures:
      | initials | deposit | signed at |
      | ANN      | £500    | 09:00     |
      | BOB      | £1,000  | 09:05     |
      | CAT      | £1,000  | 09:01     |
      | DAN      | £50     | 09:00     |
      | EVE      | £2,000  | 09:00     |
      | FAY      | £150    | 09:00     |
      | GUS      | £300    | 09:00     |
      | HAL      | £250    | 09:00     |
      | IVY      | £100    | 09:00     |
      | JON      | £750    | 09:00     |
      | KIT      | £200    | 09:00     |
      | LEN      | £350    | 09:00     |
    When someone reads the high-score table
    Then the high-score table answers with these rows, in order:
      | initials | deposit |
      | EVE      | £2,000  |
      | CAT      | £1,000  |
      | BOB      | £1,000  |
      | JON      | £750    |
      | ANN      | £500    |
      | LEN      | £350    |
      | GUS      | £300    |
      | HAL      | £250    |
      | KIT      | £200    |
      | FAY      | £150    |
    And the table is left as it was

  @OUT-7 @DDD-1 @DDD-18 @server @real-io @edge
  Scenario: Stray entries that aren't signatures are ignored when the table is read
    Given the high-score table holds FAB with £1,000
    And the high-score table also holds stray entries that aren't signatures
    When someone reads the high-score table
    Then the high-score table answers with these rows, in order:
      | initials | deposit |
      | FAB      | £1,000  |
    And the table is left as it was

  @OUT-7 @DDD-6 @DDD-17 @server @real-io @error
  Scenario: A reader is told the table failed when it can't be looked at, and the owner is told why, without the player's details
    Given the high-score table holds FAB with £1,000
    And looking at the high-score table fails
    When someone reads the high-score table
    Then the answer is that the table failed unexpectedly
    And the owner can see it was a failed look at the table
    And what the owner sees says nothing about the player
    And the table is left as it was
