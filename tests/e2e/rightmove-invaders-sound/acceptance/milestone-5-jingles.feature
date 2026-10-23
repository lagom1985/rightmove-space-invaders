@sizing-review-needed
Feature: Big-moment jingles (US-05)
  When I save the Dream Home, clear a wave or lose, I want a distinctive jingle,
  so the big moments feel rewarding.

  @US-05 @real-io
  Scenario: Starting a game rings the doorbell
    Given I have just opened the game
    When I start a game
    Then I hear the doorbell

  @US-05 @in-memory
  Scenario: The siren plays while the Dream Home is on screen
    Given a game is running with sound on and music on
    When the game reports the Dream Home appearing
    Then the Dream Home siren is looping

  @US-05 @in-memory
  Scenario: The siren stops when the Dream Home leaves
    Given a game is running with sound on and music on
    And the Dream Home is on screen
    When the game reports the Dream Home leaving
    Then the Dream Home siren is stopped

  @US-05 @in-memory
  Scenario: Saving the Dream Home stops the siren and plays ka-ching
    Given a game is running with sound on and music on
    And the Dream Home is on screen
    When the game reports the Dream Home being saved
    Then ka-ching is played
    And the Dream Home siren is stopped

  @US-05 @in-memory
  Scenario: Clearing a wave stops the siren and plays the fanfare
    Given a game is running with sound on and music on
    And the Dream Home is on screen
    When the game reports a wave being cleared
    Then the wave-cleared fanfare is played
    And the Dream Home siren is stopped

  @US-05 @real-io
  Scenario: Losing the game plays the game-over tune
    Given I am playing with sound on
    When I stand still until the game is over
    Then I hear the game-over tune

  @US-05 @in-memory @error
  Scenario: Game over silences the Dream Home siren
    Given a game is running with sound on and music on
    And the Dream Home is on screen
    When the game reports game over
    Then the game-over tune is played
    And the Dream Home siren is stopped

  @US-05 @in-memory @error
  Scenario: Pausing silences the Dream Home siren
    Given a game is running with sound on and music on
    And the Dream Home is on screen
    When the game reports a pause
    Then the Dream Home siren is stopped

  @US-05 @in-memory @edge
  Scenario: Resuming brings the siren back while the Dream Home is still on screen
    Given a game is running with sound on and music on
    And the Dream Home is on screen
    And the game is paused
    When the game reports play resuming
    Then the Dream Home siren is looping
