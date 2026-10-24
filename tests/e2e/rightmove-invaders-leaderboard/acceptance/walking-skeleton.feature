Feature: Arcade high-score table
  A house-hunter whose deposit makes the high-score table signs it with three initials, like on an
  arcade cabinet, and everyone who opens the game sees the same table.

  @walking_skeleton @driving_port
  Scenario: A house-hunter signs the high-score table and another house-hunter sees it
    Given the high-score table is empty
    And I open the game on a desktop browser for the first time
    When I press Enter to start
    And I tap Space to fire at the hurdle above me
    And I stop playing until the hurdles win
    Then I am asked for my initials for a deposit saved of "£50"
    When I enter the initials "FAB"
    Then the high-score table is topped by "FAB" with "£50"
    When another house-hunter opens the game on their own computer
    Then the high-score table is topped by "FAB" with "£50"
