Feature: Background music (US-06)
  When I settle in for a session, I want background music that sets the mood,
  so it feels like a complete arcade game.

  @US-06 @real-io @pending
  Scenario: Music plays under the game
    Given I have just opened the game
    When I start a game
    Then I hear the music

  @US-06 @in-memory @error @pending
  Scenario: Music pauses with the game
    Given a game is running with sound on and music on
    When the game reports a pause
    Then the music is stopped

  @US-06 @in-memory @error @pending
  Scenario: Music stops on game over
    Given a game is running with sound on and music on
    When the game reports game over
    Then the music is stopped

  @US-06 @in-memory @edge @pending
  Scenario: Turning the sound back on brings the music back
    Given a game is running with sound off and music on
    When the player switches the sound on
    Then the music is playing

  @US-06 @in-memory @pending
  Scenario: Music comes back when play resumes
    Given a game is running with sound on and music on
    And the game is paused
    When the game reports play resuming
    Then the music is playing
