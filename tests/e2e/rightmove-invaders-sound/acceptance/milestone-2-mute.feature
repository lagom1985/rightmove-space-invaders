@sizing-review-needed
Feature: Silence it with M (US-02)
  When sound isn't welcome, I want to silence the game with one key,
  so I can keep playing without bothering anyone.

  @US-02 @real-io @pending
  Scenario: M silences the game in the middle of a wave
    Given I am playing with sound on
    And I have heard a shot
    When I press M
    Then all sound stops at once
    And the sound setting shows "Off"
    And the game announces "Sound off. Press M to turn it on."

  @US-02 @real-io @pending
  Scenario: Shots make no sound while the sound is off
    Given I am playing with sound off
    When I fire at the hurdle above me
    Then the deposit saved shows £50
    And the game stays silent

  @US-02 @real-io @pending
  Scenario: M turns the sound back on
    Given I am playing with sound off
    When I press M
    Then the sound setting shows "On"
    And the game announces "Sound on."
    And I hear a beat note

  @US-02 @real-io @pending
  Scenario: The game remembers that the sound was off
    Given I turned the sound off on an earlier visit
    When I start a game
    Then the sound setting shows "Off"
    And the game has made no sound

  @US-02 @real-io @edge @pending
  Scenario Outline: M switches the sound off on the <screen> screen
    Given I am on the <screen> screen
    When I press M
    Then the sound setting shows "Off"

    Examples:
      | screen    |
      | title     |
      | pause     |
      | game over |

  @US-02 @real-io @error @pending
  Scenario: Sound still starts on when saved settings are unavailable
    Given I have just opened the game in a browser that blocks saved settings
    And the sound setting shows "On"
    When I press M
    Then the sound setting shows "Off"

  @US-02 @in-memory @property @pending
  Scenario: While the sound is off, nothing the game does makes a sound
    Given a game is running with sound off and music on
    When the game reports any sequence of events
    Then nothing that makes a sound is played
    And the same events with the sound on make the sounds a player expects

  @US-02 @in-memory @edge @pending
  Scenario: Turning the sound back on brings back the Dream Home siren
    Given a game is running with sound off and music on
    And the Dream Home is on screen
    When the player switches the sound on
    Then the Dream Home siren is looping

  @US-02 @in-memory @edge @pending
  Scenario: Turning the sound on while paused stays silent until play resumes
    Given a game is running with sound off and music on
    And the game is paused
    When the player switches the sound on
    Then nothing that makes a sound is played
