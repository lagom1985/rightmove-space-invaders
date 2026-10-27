Feature: The same game, played back anywhere
  A recorded game plays back to the same deposit and the same game-over step where the table replays it, and in
  Chromium, Firefox and WebKit, where it was played. The recorded games are kept, and every build plays them back, so a
  change to how the game plays can't slip through without a new rules version (D10, D13).
  The check only reads the recorded games. They are made apart, once the rules are deterministic and after every rules
  version bump: node scripts/record-corpus.mjs, which refuses to overwrite a game recorded on the same rules version.

  # Through the table itself: each recorded game signs, with a session issued as long before as it lasted. A game on
  # other rules would be refused as such, so this also catches a version bump without a new recording.
  @pending @corpus @US-03 @US-06 @D10 @D13 @DDD-R12 @server @real-io @kpi-K21
  Scenario: The table saves every recorded game at its recorded deposit, having played it back to its last step
    Given the recorded games, from about a minute to at least 15 minutes long
    When each of them signs the high-score table, as long after its session was issued as it lasted
    Then the table saves every one, at its recorded deposit, having played back every step it recorded

  # No driving port runs the replay in a browser, so this one loads the game's replay into a page, as DESIGN's DDD-R12
  # prescribes: that every engine plays the same game is the point (a recorded deviation from Mandate 1, ATDD policy).
  @corpus @US-03 @D13 @DDD-R12 @real-io @kpi-K21
  Scenario: Every recorded game plays back as it was recorded, in this browser
    Given the recorded games, from about a minute to at least 15 minutes long
    When this browser replays every one of them
    Then each one ends at game over at its recorded step, with its recorded deposit

  # Stands for a change to how the game plays made without a new rules version: a recorded game no longer replays to
  # what was recorded, its deposit or its game-over step.
  @pending @corpus @US-06 @D10 @DDD-R12 @server @real-io @error @kpi-K21
  Scenario Outline: A recorded game that now ends <how> is refused by the table, by name
    Given the recorded games, one of them changed to end <how>
    When each of them signs the high-score table, as long after its session was issued as it lasted
    Then the table refuses that game, and only that one, as not the game it claims

    Examples:
      | how                    |
      | on another deposit     |
      | at another moment      |
