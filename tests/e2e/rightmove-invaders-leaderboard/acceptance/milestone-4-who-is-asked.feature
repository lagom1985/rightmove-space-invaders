Feature: Only a deposit that makes the table is asked for initials
  Like on an arcade cabinet, a house-hunter is asked for initials only when their deposit makes the shared top ten:
  while the table has room, or by beating its 10th row. A tie with the 10th row misses, and so does no deposit.

  @OUT-10 @OUT-14 @DDD-3 @DDD-14 @real-io
  Scenario: A deposit is asked for initials while the table has room
    Given the high-score table holds 9 signatures of £1,000
    When I finish a game with a deposit of £50
    Then I am asked for my initials
    And the initials field shows "A A A, letter 1 of 3"

  # Not @pending: the skeleton already behaves so, and no DELIVER step changes what this checks (regression guard).
  @OUT-10 @DDD-3 @real-io @edge
  Scenario Outline: A deposit that doesn't beat a 10th row of <lowest> is not asked for initials
    Given the high-score table holds 10 signatures of <lowest>
    When I finish a game with a deposit of £50
    Then I am not asked for my initials
    And the high-score table is shown with 10 rows

    Examples:
      | lowest |
      | £100   |
      | £50    |

  # Not @pending: the skeleton already behaves so, and no DELIVER step changes what this checks (regression guard).
  @OUT-10 @DDD-3 @real-io @edge
  Scenario: A game that ends without a deposit is never asked for initials, even by an empty table
    Given the high-score table is empty
    When I finish a game without a deposit
    Then I am not asked for my initials
