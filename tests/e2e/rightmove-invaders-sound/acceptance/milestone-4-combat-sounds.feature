Feature: Combat sounds (US-04)
  When the screen is busy, I want to hear when a house is hit, when I lose a home
  and when I stop a bolt, so I know whether to move.

  @US-04 @real-io @pending
  Scenario: A shot into a house makes a thud
    Given I am playing with sound on
    When I fire into the second house
    Then I hear a house being hit

  @US-04 @in-memory @pending
  Scenario: A bolt hitting a house makes a thud
    Given a game is running with sound on and music on
    When the game reports a bolt hitting a house
    Then a house being hit is played

  @US-04 @real-io @pending
  Scenario: Losing a home is heard
    Given I am playing with sound on
    When I lose a home
    Then I hear an explosion

  @US-04 @in-memory @pending
  Scenario: Stopping a bolt with a shot makes a tink
    Given a game is running with sound on and music on
    When the game reports a bolt being stopped
    Then a bolt being stopped is played

  @US-04 @in-memory @edge @pending
  Scenario: Seven hits in 120 ms make three thuds
    Given a game is running with sound on and music on
    When the game reports 7 house hits 20 ms apart
    Then 3 thuds are played
    And the thuds play "0, 60, 120" ms after the first hit

  @US-04 @in-memory @property @edge @pending
  Scenario: House hits never sound closer together than 50 ms
    Given a game is running with sound on and music on
    When houses are hit in any burst
    Then the thuds are at least 50 ms apart and none is dropped needlessly
