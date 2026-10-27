Feature: Hear your shots (US-01)
  When I fire or hit something, I want to hear it straight away,
  so I know my action landed without taking my eyes off the formation.

  @US-01 @real-io @error @kpi-K7
  Scenario: The game stays silent until the first key press
    Given I have just opened the game
    When 5 seconds pass on the title screen
    Then the game has made no sound
    And the game's sound is waiting for a key press
    And no errors or audio warnings are reported

  @US-01 @real-io @kpi-K5
  Scenario: A shot is heard in the same frame it is fired
    Given I am playing with sound on
    When I press Space
    Then I hear a shot within one frame

  @US-01 @real-io
  Scenario: Every shot is heard
    Given I am playing with sound on
    When I fire 3 shots a second apart
    Then I hear 3 shots

  @US-01 @in-memory
  Scenario: The hit sound knows which hurdle was hit
    Given a game is running with sound on and music on
    When the game reports a hurdle worth £300 being hit
    Then a hit on a hurdle worth £300 is played

  @US-01 @real-io @adapter-integration @edge
  Scenario: A burst of sounds never plays more than eight at once
    Given the game's sound is ready on its own
    When 20 shots start at the same moment
    Then all 20 shots were started
    And no more than 8 sounds ever played at once

  @US-01 @real-io @error @kpi-K7
  Scenario: The game plays silently when sound is unavailable
    Given I have just opened the game in a browser without sound
    And I have started a game
    When I fire at the hurdle above me
    Then the deposit saved shows £50
    And the game's sound is unavailable
    And no errors or audio warnings are reported

  @US-01 @real-io @error @kpi-K7
  Scenario: The game plays silently when sound fails to start
    Given I have just opened the game in a browser where sound fails to start
    And I have started a game
    When I fire at the hurdle above me
    Then the deposit saved shows £50
    And the game's sound is unavailable
    And no errors or audio warnings are reported

  # A script on the page, such as an autopilot pasted in the devtools console, presses keys with synthetic key events,
  # whose isTrusted is false: the game doesn't play them (ADR-009, 2026-10-27). A person's key press is trusted, and so is
  # each of Playwright's.
  @US-01 @real-io @error
  Scenario: A key pressed by a script on the page starts no game
    Given I have just opened the game
    When a script on the page presses Enter
    Then the game announces "Press Enter to start"
    When I start a game
    Then the game announces "Game started"

  @US-01 @real-io @error
  Scenario: A key pressed by a script on the page fires no shot
    Given I am playing with sound on
    When a script on the page presses Space
    Then I don't hear a shot
    When I press Space
    Then I hear a shot
