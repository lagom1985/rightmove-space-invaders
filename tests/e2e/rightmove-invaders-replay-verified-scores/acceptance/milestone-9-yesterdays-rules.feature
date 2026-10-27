Feature: A game played on other rules is turned away cleanly
  A record names the rules it was played on. A record from rules the table doesn't play, from a page left open across
  a deploy that changed how the game plays, is refused as such, without a replay, so the owner can tell it from a
  forgery. The player sees what every refusal shows, "Couldn't confirm" (milestone 5 checks that path in the browser);
  that a reload puts it right is the release note's advice and DELIVER's check by hand (D5, D10).

  @US-06 @D10 @DDD-R12 @DDD-R14 @server @real-io @error @kpi-K23
  Scenario: A record from other rules is refused without being replayed
    Given the high-score table holds KIM with £2,000
    When Alex's game signs ALX with £1,250, carrying its session and a record that names other rules than the table plays
    Then the signature is refused as played on other rules
    And the owner can see why it was refused
    And the owner can see the game was never replayed
    And the table is left as it was
