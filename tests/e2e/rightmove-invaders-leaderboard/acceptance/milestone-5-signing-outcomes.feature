@sizing-review-needed
Feature: Every signing has an outcome
  A signing shows as pending until the table answers, then as confirmed (with its rank, and my row marked), off the
  table, or unconfirmed. The game never claims more than it knows, and Enter never waits for the table.

  @OUT-11 @OUT-14 @DDD-8 @real-io
  Scenario: My signing shows as pending until the table answers
    Given the high-score table holds 3 signatures of £1,000
    And my deposit of £50 makes the high-score table
    And the high-score table is slow to answer signings
    When I sign the table as FAB
    Then the game tells me "Signing FAB…"
    And no row on the high-score table is marked as mine

  @OUT-11 @OUT-14 @DDD-8 @DDD-14 @real-io
  Scenario: The table confirms my signing and marks my row
    Given my signing of FAB is on its way
    When the table answers my signing
    Then the game tells me "Signed FAB, #1."
    And FAB's row on the high-score table is marked as mine

  @OUT-11 @OUT-14 @DDD-7 @DDD-8 @real-io @edge
  Scenario: The table filled up before my signing arrived
    Given the high-score table holds 9 signatures of £1,000
    And my deposit of £50 makes the high-score table
    And another house-hunter has since signed with £1,000
    When I sign the table as FAB
    Then the game tells me "The table filled up before FAB arrived."
    And no row on the high-score table is marked as mine

  @OUT-11 @OUT-14 @DDD-8 @DDD-13 @DDD-16 @real-io @error
  Scenario Outline: When the high-score table <trouble>, I am told my signing couldn't be confirmed
    Given the high-score table holds 3 signatures of £1,000
    And my deposit of £50 makes the high-score table
    And the high-score table <trouble> when I sign
    When I sign the table as FAB
    Then the game tells me "Couldn't confirm FAB's signing."
    And no row on the high-score table is marked as mine

    Examples:
      | trouble                |
      | loses the connection   |
      | turns the signing away |

  @OUT-11 @OUT-14 @DDD-13 @DDD-16 @real-io @error @edge
  Scenario Outline: A signing with no answer after <wait> is <verdict>
    Given my signing of FAB is on its way
    When <wait> pass without an answer
    Then the game tells me "<message>"

    Examples:
      | wait        | verdict       | message                         |
      | 4.9 seconds | still pending | Signing FAB…                    |
      | 5 seconds   | given up      | Couldn't confirm FAB's signing. |

  @OUT-11 @OUT-14 @DDD-10 @real-io @error
  Scenario: Initials on the word filter are refused, and I can change a letter
    Given my deposit of £50 makes the high-score table
    When I sign the table with initials on the word filter
    Then the game tells me "Those initials aren't allowed. Change a letter."
    And the initials field still shows those initials, with letter 1 of 3 to change
    And the high-score table is still empty

  @OUT-11 @OUT-14 @DDD-14 @real-io
  Scenario: The initials field tells me the letters and which one I am choosing
    Given my deposit of £50 makes the high-score table
    When I choose the letter F and move on to the next letter
    Then the initials field shows "F A A, letter 2 of 3"
    And the game tells me "F A A, letter 2 of 3"

  @OUT-11 @OUT-14 @DDD-14 @real-io @edge
  Scenario Outline: Up pressed 3 times <spacing> is announced <count> times, once per change of letter
    Given my deposit of £50 makes the high-score table
    When I press Up 3 times <spacing>
    Then the initials field shows "<field>"
    And the letters I chose were announced <count> times

    Examples:
      | spacing          | field                | count |
      | a frame apart    | D A A, letter 1 of 3 | 3     |
      | within one frame | B A A, letter 1 of 3 | 1     |

  # Not @pending: the skeleton already sends a signing once, and DELIVER must keep it so (regression guard, ADR-008).
  @OUT-11 @DDD-8 @DDD-16 @real-io @error
  Scenario: A signing that was dropped is sent exactly once, never retried
    Given the high-score table holds 3 signatures of £1,000
    And my signing of FAB is unconfirmed
    When 10 seconds pass without an answer
    Then my signing was sent only once

  # Not @pending: Enter already restarts from every state, and the signing lifecycle DELIVER adds must not change that
  # (regression guard: Enter never waits on the table, ADR-008). Its Givens arrange a signing without asserting its words.
  @OUT-11 @DDD-8 @real-io @edge
  Scenario Outline: Enter starts a new game when my signing is <status>
    Given the high-score table holds 9 signatures of £1,000
    And my signing of FAB is <status>
    When I press Enter
    Then a new game starts

    Examples:
      | status        |
      | on its way    |
      | confirmed     |
      | off the table |
      | unconfirmed   |
