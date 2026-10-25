Feature: The signing and table rules, whatever order the answers arrive in
  The game's rules on their own, with the table's answers and failures handed over in any order and with any
  listing time. This also covers what the keyboard can't reach within the 5-second timeout: a game that ends before
  the table has ever answered, and the answer to a signing that a newer signing has replaced.

  @OUT-10 @OUT-11 @OUT-12 @DDD-8 @DDD-9 @DDD-12 @in-memory @property @pending
  Scenario: Whatever order the table's answers arrive in, the signing and the table follow the rules
    Given the game's rules are running on their own
    When the player plays any sequence of games, signings and table answers, in any order
    Then the table, the signing and what is announced always follow the rules

  @OUT-12 @DDD-9 @in-memory @edge @pending
  Scenario: A game that ends before the table has ever answered asks for no initials
    Given the game's rules are running on their own
    And the high-score table has not answered yet
    When a game ends with a deposit of £50
    Then no initials are asked for
    And the game-over screen shows no table

  @OUT-11 @DDD-8 @in-memory @edge @pending
  Scenario: The answer to a signing I have since replaced is announced once and changes nothing else
    Given the game's rules are running on their own
    And FAB's signing is on its way
    And a newer signing by ABC has been confirmed at #1
    When the table answers FAB's signing at #2
    Then FAB's signing is announced once, as confirmed at #2
    And ABC's signing is still the current one, confirmed at #1 and marked as mine
