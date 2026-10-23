Feature: Make the Right Move
  A house-hunter plays a game on a desktop keyboard, and their best deposit is remembered
  for the next time they visit.

  @walking_skeleton @driving_port
  Scenario: A house-hunter's best deposit is remembered after the game ends
    Given I open the game on a desktop browser for the first time
    Then the title screen shows a best deposit of "£0"
    When I press Enter to start
    And I tap Space to fire at the hurdle above me
    Then my deposit saved is "£50"
    When I stop playing until the hurdles win
    Then the game is over with a deposit saved of "£50"
    When I come back to the game later
    Then the title screen shows a best deposit of "£50"
