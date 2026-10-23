Feature: Turn just the music off with N (US-07)
  When the music isn't for me, I want to turn just the music off,
  so I keep the sound effects.

  @US-07 @real-io @pending
  Scenario: N turns just the music off
    Given I am playing with sound on
    And I hear the music
    When I press N
    Then I don't hear the music
    And the music setting shows "Off"
    And the sound setting shows "On"
    And the game announces "Music off. Press N to turn it on."

  @US-07 @real-io @pending
  Scenario: The game remembers that the music was off
    Given I turned the music off on an earlier visit
    When I start a game
    Then I don't hear the music
    And the music setting shows "Off"

  @US-07 @in-memory @pending
  Scenario: With the music off, effects still play
    Given a game is running with sound on and music off
    When the game reports a shot
    Then a shot is played

  @US-07 @in-memory @edge @pending
  Scenario: Unmuting brings the music back only if it was on
    Given a game is running with sound off and music off
    When the player switches the sound on
    Then the music is stopped

  @US-07 @real-io @edge @pending
  Scenario Outline: N switches the music off on the <screen> screen
    Given I am on the <screen> screen
    When I press N
    Then the music setting shows "Off"

    Examples:
      | screen    |
      | title     |
      | pause     |
      | game over |

  @US-07 @real-io @error @pending
  Scenario: Music still starts on when saved settings are unavailable
    Given I have just opened the game in a browser that blocks saved settings
    And the music setting shows "On"
    When I press N
    Then the music setting shows "Off"
