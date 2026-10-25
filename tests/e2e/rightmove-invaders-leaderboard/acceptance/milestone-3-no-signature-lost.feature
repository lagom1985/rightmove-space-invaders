Feature: No signature is lost
  Players who sign at the same moment never overwrite each other: every signature is a row of its own. Each signing
  tidies away old scores from below the top ten once more than 20 are kept: as many as are over 20, never more than
  five, never a top-ten row, and never anything that isn't a score. Tidying up is best effort, so a signing never
  fails because of it.

  @OUT-9 @DDD-1 @server @real-io @edge
  Scenario Outline: With <held> scores already kept, a new signing tidies away <loses>
    Given the high-score table holds <held> scores
    And the high-score table also holds stray entries that aren't signatures
    When the high-score table receives the signature FAB with £10,000
    Then the answer is accepted
    And the table gains FAB's row and loses <loses>
    And the stray entries that aren't signatures are all still there

    Examples:
      | held | loses                                              |
      | 19   | no old scores                                      |
      | 20   | exactly 1 old score, ranked 11th or lower          |
      | 30   | exactly 5 old scores, all ranked 11th or lower     |

  @OUT-9 @DDD-1 @DDD-17 @server @real-io @error
  Scenario: A signing is still saved and answered when tidying up fails
    Given the high-score table holds 25 scores
    And tidying up old scores fails
    When the high-score table receives the signature FAB with £10,000
    Then the answer shows FAB's new row at #1
    And the table gains FAB's row and loses no old scores
    And the owner can see it was a failed tidy-up
    And what the owner sees says nothing about the player

  @OUT-9 @DDD-1 @server @real-io @property @kpi-K11 @pending
  Scenario: However many signatures arrive at once, none that belongs in the top ten is lost
    Given nobody has signed the high-score table yet
    When any batch of up to 30 valid signatures arrives at the same moment
    Then every signer is answered, and the table shows exactly the best 10 of them
