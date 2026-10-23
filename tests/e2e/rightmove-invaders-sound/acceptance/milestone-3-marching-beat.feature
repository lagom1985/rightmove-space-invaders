@sizing-review-needed
Feature: The marching beat (US-03)
  When the hurdles get fewer, faster and closer, I want to hear the pressure rising,
  so the game feels urgent.

  @US-03 @real-io
  Scenario: The formation marches to a four-note beat at its own pace
    Given I am playing with sound on
    When the formation marches 8 steps
    Then the beat notes go "1 2 3 4 1 2 3 4"
    And the beat notes are about 0.53 seconds apart

  @US-03 @in-memory @property
  Scenario: Exactly one beat note per formation step, whatever the pace
    Given a game is running with sound on and music on
    When the formation takes any number of steps at any pace
    Then one beat note plays per step, cycling through four notes

  @US-03 @real-io @error
  Scenario Outline: Pausing with <key> stops the beat
    Given I am playing with sound on
    When I pause with <key> for 5 seconds
    Then the game stays silent

    Examples:
      | key    |
      | P      |
      | Escape |

  @US-03 @real-io
  Scenario: Resuming starts the beat again
    Given I am playing with sound on
    And I have paused the game
    When I press P
    Then I hear a beat note

  @US-03 @real-io @error
  Scenario: Losing a home stops the beat until the pin is back
    Given I am playing with sound on
    And the formation has marched 2 steps
    When I lose a home
    Then the beat stays silent while the pin respawns
    And the beat plays again once the pin is back

  @US-03 @real-io @error
  Scenario: Switching to another window silences the game without waiting for the next frame
    Given I am playing with sound on
    And the formation has marched 2 steps
    When I switch to another window
    Then all sound stops at once

  @US-03 @real-io @error
  Scenario: Hiding the game's tab silences the game without waiting for the next frame
    Given I am playing with sound on
    And the formation has marched 2 steps
    When I hide the game's tab
    Then all sound stops at once

  @US-03 @in-memory @property @edge
  Scenario: No beat after game over until a new game starts
    Given a game is running with sound on and music on
    When the game ends and any events follow, including new games
    Then beat notes play only while a game is in progress
