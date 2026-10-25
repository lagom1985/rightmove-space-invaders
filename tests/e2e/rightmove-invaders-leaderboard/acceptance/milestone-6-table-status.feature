Feature: The game plays fully without the table
  The table is unavailable only while it has never loaded. It is refreshed in the background whenever a game starts,
  and a failed refresh keeps the last good table, so a deposit that makes it is still asked for initials.

  @OUT-12 @OUT-14 @DDD-9 @DDD-16 @DDD-18 @real-io @error
  Scenario: When the high-score table can't be reached, the game says so at game over and plays on
    Given the high-score table can't be reached
    When I finish a game with a deposit of £50
    Then the game tells me "High-score table unavailable."
    And I am not asked for my initials
    And no high-score table is shown

  # Not @pending: the skeleton already behaves so, and no DELIVER step changes what this checks (regression guard).
  # The canvas side ("the hurdles only") is the manual check (D10).
  @OUT-12 @DDD-9 @DDD-16 @real-io @error
  Scenario: The title screen shows no high-score table while it can't be reached
    Given the high-score table can't be reached
    When I open the game
    Then no high-score table is shown

  @OUT-12 @DDD-7 @real-io
  Scenario: The table is refreshed when a game starts
    Given the high-score table holds 9 signatures of £1,000
    And I have opened the game
    And another house-hunter has since signed with £1,000
    When I finish a game with a deposit of £50
    Then I am not asked for my initials
    And the high-score table is shown with 10 rows

  @OUT-12 @DDD-9 @DDD-16 @real-io @error
  Scenario: A failed refresh keeps the last good table, and I am still asked for initials
    Given the high-score table holds 9 signatures of £1,000
    And I have opened the game
    And another house-hunter has since signed with £1,000
    And the high-score table can't be reached
    When I finish a game with a deposit of £50
    Then the game tried to refresh the table when the game started
    And I am asked for my initials
    And the high-score table is shown with 9 rows
    And the game doesn't say the high-score table is unavailable

  @OUT-12 @OUT-14 @DDD-9 @DDD-13 @DDD-16 @real-io @error
  Scenario: A first load that never answers leaves the table unavailable once the game gives up on it
    Given the high-score table doesn't answer when asked for its rows
    When I finish a game with a deposit of £50
    Then the game tells me "High-score table unavailable."
    And I am not asked for my initials
    And no high-score table is shown

  @OUT-12 @DDD-9 @DDD-13 @DDD-16 @real-io @error
  Scenario: A refresh that never answers keeps the last good table, and I am still asked for initials
    Given the high-score table holds 9 signatures of £1,000
    And I have opened the game
    And the high-score table doesn't answer when asked for its rows
    When I finish a game with a deposit of £50
    Then the game tried to refresh the table when the game started
    And I am asked for my initials
    And the high-score table is shown with 9 rows
    And the game doesn't say the high-score table is unavailable
