Feature: The signing and table rules, whatever order the answers arrive in
  The game's rules on their own, with the table's answers and failures handed over in any order and with any
  listing time. This also covers what the keyboard can't reach within the 5-second timeout: a game that ends before
  the table has ever answered, and the answer to a signing that a newer signing has replaced.

  @OUT-10 @OUT-11 @OUT-12 @DDD-8 @DDD-9 @DDD-12 @in-memory @property
  Scenario: Whatever order the table's answers arrive in, the signing and the table follow the rules
    Given the game's rules are running on their own
    When the player plays any sequence of games, signings and table answers, in any order
    Then the table, the signing and what is announced always follow the rules

  @OUT-12 @DDD-9 @in-memory @edge
  Scenario: A game that ends before the table has ever answered asks for no initials
    Given the game's rules are running on their own
    And the high-score table has not answered yet
    When a game ends with a deposit of £50
    Then no initials are asked for
    And the game-over screen shows no table

  # The plausible ceiling (docs/analysis/root-cause-analysis-forged-high-scores.md, S1): the table refuses a score above
  # it, so the game never asks for initials it would send in vain.
  @OUT-10 @DDD-3 @in-memory @edge
  Scenario Outline: An empty table asks a deposit of <deposit> for initials only up to the plausible ceiling
    Given the game's rules are running on their own
    And the high-score table has answered with no signatures
    When a game ends with a deposit of <deposit>
    Then <outcome>

    Examples:
      | deposit    | outcome                   |
      | £500,000   | initials are asked for    |
      | £500,050   | no initials are asked for |
      | £9,999,950 | no initials are asked for |

  @OUT-11 @DDD-8 @in-memory @edge
  Scenario: The answer to a signing I have since replaced is announced once and changes nothing else
    Given the game's rules are running on their own
    And FAB's signing is on its way
    And a newer signing by ABC has been confirmed at #1
    When the table answers FAB's signing at #2
    Then FAB's signing is announced once, as confirmed at #2
    And ABC's signing is still the current one, confirmed at #1 and marked as mine
