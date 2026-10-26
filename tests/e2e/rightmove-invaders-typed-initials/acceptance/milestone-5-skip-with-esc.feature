@sizing-review-needed
Feature: Skipping the signing with Esc (US-05)
  When my deposit makes the table but I'd rather not put my initials up, I want to pass with one key, so I can get
  straight back to playing. Nothing is sent, the deposit stays off the table, an earlier signing keeps its mark, my
  best deposit is kept as usual, and Enter starts the next game.

  # My first game makes the £50 my best deposit; the best is saved when the game ends, before the entry opens (D16).
  @US-05 @slice-02 @kpi @kpi-K18 @kpi-K19 @real-io @contract-shape:unbounded-preservation @DDD-T7 @pending
  Scenario: Esc skips signing
    Given the high-score table holds 3 signatures of £1,000
    And my deposit of £50 makes the high-score table
    When I press Esc
    Then the game tells me "Signing skipped. Press Enter to house-hunt again."
    And nothing is sent to the high-score table
    And the high-score table is shown with 3 rows
    And the game makes no sound for it
    And my best deposit of "£50" is kept for my next visit

  @US-05 @slice-02 @real-io @edge @contract-shape:unbounded-preservation @DDD-T7 @pending
  Scenario Outline: Letters already typed are dropped: "<typed>"
    Given my deposit of £50 makes the high-score table
    And I have typed "<typed>"
    When I press Esc
    Then the game tells me "Signing skipped. Press Enter to house-hunt again."
    And nothing is sent to the high-score table

    Examples:
      | typed |
      | ps    |
      | psh   |

  @US-05 @slice-02 @real-io @contract-shape:bounded-change @DDD-T7 @pending
  Scenario: Enter plays again after a skip
    Given my deposit of £50 makes the high-score table
    And I have skipped signing
    When I press Enter
    Then a new game starts

  @US-05 @slice-02 @real-io @contract-shape:bounded-change @DDD-T2 @DDD-T7 @pending
  Scenario: The game keys work again after a skip
    Given my deposit of £50 makes the high-score table
    And I have skipped signing
    When I press the M key
    Then the HUD shows Sound Off

  @US-05 @slice-02 @real-io @edge @contract-shape:unbounded-preservation @DDD-T7 @pending
  Scenario: An earlier signing keeps its mark
    Given my signing of ALX is confirmed
    And I have started a new game
    And my deposit of £50 makes the high-score table
    When I press Esc
    Then the game tells me "Signing skipped. Press Enter to house-hunt again."
    And ALX's row on the high-score table is marked as mine

  @US-05 @slice-02 @kpi @kpi-K18 @real-io @error @contract-shape:unbounded-preservation @DDD-T5 @pending
  Scenario: Esc pressed as the game ends doesn't skip
    Given the game ended 0.3 seconds ago with a deposit of £50 that makes the high-score table
    When I press Esc
    Then the initials field still shows "No letters yet, letter 1 of 3"
    And nothing is announced as skipped

  @US-05 @slice-02 @real-io @error @contract-shape:bounded-change @DDD-T6 @pending
  Scenario: The hint offers the way out
    Given my deposit of £50 makes the high-score table
    When I press Enter
    Then the game tells me "Type 3 letters to sign, or press Esc to skip."

  @US-05 @slice-02 @kpi @kpi-K18 @real-io @contract-shape:bounded-change @pending
  Scenario: The invitation to sign says how to skip
    Given the high-score table holds 9 signatures of £1,000
    When I finish a game with a deposit of £50
    Then the game tells me "New high score! Enter your initials: type 3 letters, then press Enter to sign. Esc skips."
