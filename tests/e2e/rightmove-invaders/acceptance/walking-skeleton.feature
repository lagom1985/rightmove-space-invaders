Feature: Make the Right Move
  A house-hunter plays a game on a desktop keyboard, and their best deposit is remembered
  for the next time they visit.

  # A whole game takes 15-20 s of real time per browser, more with every worker busy: 90 s in all, not the default 30 s
  # (playwright-bdd's @timeout tag, on this scenario alone).
  @walking_skeleton @driving_port @timeout:90000
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
