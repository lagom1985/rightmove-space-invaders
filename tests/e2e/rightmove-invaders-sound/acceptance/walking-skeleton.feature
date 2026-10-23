Feature: Sound walking skeleton
  Alex hears the game react to the keys they press.

  @walking_skeleton @driving_port @real-io @US-01
  Scenario: Alex hears their shot and the hurdle it hits
    Given I have just opened the game
    And I have started a game
    When I fire at the hurdle above me
    Then I hear a shot
    And I hear a hit on a hurdle worth £50
