@sizing-review-needed
Feature: Signing the shared high-score table
  A house-hunter whose deposit makes the table signs it with three initials. The high-score table keeps every valid
  signature as a row of its own, refuses anything else without saving it, and answers with the table as it now
  stands, so the signer can find their row.

  @OUT-8 @DDD-1 @DDD-6 @DDD-12 @DDD-17 @driving_port @server @real-io @kpi-K14
  Scenario: A valid signature is saved, and the answer shows where it ranks
    Given nobody has signed the high-score table yet
    When the high-score table receives the signature FAB with £1,000
    Then the signature is saved as one new row
    And the answer shows FAB's new row at #1
    And the answer says when the table was looked at
    And the answer is never kept for reuse
    And the owner can see where the table is kept and how long the signing took

  @OUT-8 @DDD-8 @server @real-io @edge
  Scenario: Signing twice with the same initials and deposit makes two rows
    Given the high-score table has saved the signature FAB with £1,000
    When the high-score table receives the signature FAB with £1,000
    Then the signature is saved as one new row
    And the answer shows FAB at #1 and at #2

  @OUT-8 @OUT-10 @DDD-3 @DDD-5 @server @real-io @edge
  Scenario Outline: The table accepts the signature <signature>
    Given nobody has signed the high-score table yet
    When the high-score table receives the signature <signature>
    Then the answer is accepted
    And the signature is saved as one new row

    Examples:
      | signature                         |
      | FAB with £50                      |
      | FAB with £250,000                 |
      | FAB with £1,000 stretched to 1 KB |

  @OUT-8 @DDD-5 @DDD-17 @server @real-io @error
  Scenario Outline: The table refuses <what> <why>, and saves nothing
    Given nobody has signed the high-score table yet
    When the high-score table receives <what>
    Then the signature is refused <why>
    And the owner can see why it was refused
    And the table is left as it was

    Examples: The wrong format or size
      | what                                                   | why            |
      | the signature FAB with £1,000 sent in the wrong format | for its format |
      | the signature FAB with £1,000 stretched past 1 KB      | as too long    |

    Examples: Not a signature
      | what                                     | why                |
      | something that isn't a signature at all  | as not a signature |
      | the signature FAB with £1,000 and a note | as not a signature |
      | the signature FAB with no deposit        | as not a signature |
      | the signature fab with £1,000            | as not a signature |
      | the signature FAB with £1,025            | as not a signature |
      | the signature FAB with £0                | as not a signature |
      | the signature FAB with £10,000,000       | as not a signature |

    Examples: More than any game could save (docs/analysis/root-cause-analysis-forged-high-scores.md, S1)
      | what                              | why            |
      | the signature FAB with £250,050   | as implausible |
      | the signature FAB with £9,999,950 | as implausible |

  @OUT-8 @OUT-10 @DDD-10 @DDD-17 @server @real-io @error @kpi-K12
  Scenario: Initials on the word filter are refused by the table too
    Given nobody has signed the high-score table yet
    When the high-score table receives a signature with initials on the word filter
    Then the signature is refused for its initials
    And the owner can see why it was refused
    And the table is left as it was

  @OUT-8 @DDD-6 @DDD-17 @server @real-io @error
  Scenario Outline: Asking the table to <demand> is refused, because it can only be read or signed
    Given the high-score table holds FAB with £1,000
    When someone asks the high-score table to <demand>
    Then they are told the table can only be read or signed
    And the owner can see why it was refused
    And the table is left as it was

    Examples:
      | demand           |
      | wipe itself      |
      | replace its rows |

  @OUT-8 @DDD-1 @DDD-4 @DDD-17 @server @real-io @error @edge
  Scenario: A signature that would land on an existing row is turned away, not saved twice
    Given the high-score table puts every new signature in the same row
    And the high-score table has saved the signature FAB with £1,000
    When the high-score table receives the signature FAB with £1,000
    Then the signature is turned away as not saved
    And the owner can see it was a duplicate
    And the table is left as it was

  @OUT-8 @DDD-4 @DDD-6 @DDD-17 @server @real-io @error
  Scenario: A signature the table fails to save is reported as an unexpected failure
    Given nobody has signed the high-score table yet
    And saving to the high-score table fails
    When the high-score table receives the signature FAB with £1,000
    Then the answer is that the table failed unexpectedly
    And the owner can see it was a failed save
    And what the owner sees says nothing about the player
    And the table gains at most one row

  @OUT-8 @DDD-17 @server @real-io @error
  Scenario: A signature saved just before the table can't be looked at stays saved, though the signer isn't told
    Given nobody has signed the high-score table yet
    And looking at the high-score table fails
    When the high-score table receives the signature FAB with £1,000
    Then the answer is that the table failed unexpectedly
    And the signature is saved as one new row
    And the owner can see it was a failed look at the table
    And what the owner sees says nothing about the player
