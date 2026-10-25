Feature: Answers that arrive late
  The table answers between frames, possibly after the next game has started. A late outcome is still announced, a
  copy of the table older than the one shown is ignored, and my confirmed row stays marked until it leaves the table.

  @OUT-11 @OUT-14 @DDD-8 @DDD-11 @DDD-14 @real-io @edge @pending
  Scenario: A signing confirmed during my next game is still announced, once
    Given my signing of FAB is on its way
    And I have started a new game
    When the table answers my signing
    Then the game tells me "Signed FAB, #1."
    And the game announced that outcome only once
    And FAB's row on the high-score table is marked as mine

  @OUT-11 @OUT-14 @DDD-8 @DDD-14 @real-io @edge @pending
  Scenario: My confirmed row stays marked on the next game-over screen, which doesn't repeat the outcome
    Given my signing of FAB was confirmed during my next game
    When I finish a game without a deposit
    Then FAB's row on the high-score table is marked as mine
    And the game-over message doesn't mention FAB

  @OUT-12 @OUT-14 @DDD-12 @DDD-14 @DDD-16 @real-io @edge @pending
  Scenario: An older copy of the table that arrives late doesn't undo my signing
    Given my signing of FAB is on its way
    And the table looked up for my next game is slow to arrive
    And I have started a new game
    And the table has answered my signing
    When the older copy of the table arrives
    Then the high-score table is topped by "FAB" with "£50"
    And FAB's row on the high-score table is marked as mine

  @OUT-11 @OUT-14 @DDD-8 @DDD-14 @real-io @edge @pending
  Scenario: A newer signing moves my mark from the older row to the new one
    Given the high-score table holds 3 signatures of £1,000
    And my signing of FAB is confirmed
    And my deposit of £50 makes the high-score table
    When I sign the table as ABC
    Then ABC's row on the high-score table is marked as mine

  @OUT-11 @OUT-14 @DDD-8 @DDD-14 @real-io @edge @pending
  Scenario: My row loses its mark when newer signings push it off the table
    Given the high-score table holds 9 signatures of £1,000
    And my signing of FAB is confirmed
    And another house-hunter has since signed with £1,000
    When I start a new game
    Then FAB is no longer on the high-score table
    And no row on the high-score table is marked as mine
