@sizing-review-needed
Feature: Only letters type while I sign (US-02)
  While I sign, every letter key types its letter, M, N, P, A and D included, and every other key does nothing. Once
  the entry closes, M, N and the other game keys work as before. A key tapped as the game ends, or held down from play,
  never reaches the table, and no key starts a browser feature, on any screen of the game.

  # "The game keeps a key from the browser" is what the scenarios observe: the game prevented the key's default, so the
  # browser starts no feature with it (Firefox's quick find on / or ', or Backspace leaving the page). "Leaves it to the
  # browser" is the opposite. The real features are a manual check in DELIVER (DoD 5): headless browsers, and the key
  # events stood in for other layouts, never run them.

  # A and D move the pin, M and N toggle the sound and the music, P pauses: during the entry they are letters. Three
  # letters at most, so two rows.
  @US-02 @slice-01 @kpi @kpi-K17 @real-io @contract-shape:bounded-change @DDD-T2
  Scenario Outline: Game keys type their letters: "<typed>"
    Given my deposit of £50 makes the high-score table
    And the sound and the music are on
    When I type "<typed>"
    Then the initials field shows "<field>"
    And the HUD shows Sound On and Music On

    Examples:
      | typed | field                      |
      | mnp   | M N P, press Enter to sign |
      | adm   | A D M, press Enter to sign |

  # One game for the eight keys DISCUSS lists (UAT 2's outline), each in a frame of its own: two kinds of key the entry
  # ignores, named keys (the arrows) and characters that aren't letters (7, Space, ., -, /).
  @US-02 @slice-01 @real-io @error @contract-shape:unbounded-preservation
  Scenario: Keys that aren't letters don't type
    Given my deposit of £50 makes the high-score table
    When I press Up, Down, Left, 7, Space, full stop, hyphen and slash, one after another
    Then after each of them the initials field still shows "No letters yet, letter 1 of 3"
    And nothing about the initials is announced

  @US-02 @slice-01 @real-io @contract-shape:bounded-change @DDD-T2
  Scenario: The game keys work again once the entry closes
    Given my deposit of £50 makes the high-score table
    And I have signed by typing "mnp" and pressing Enter
    When I press the M key
    Then the HUD shows Sound Off
    And the game tells me "Sound off. Press M to turn it on."

  @US-02 @slice-01 @real-io @error @edge @contract-shape:bounded-change @DDD-T5
  Scenario Outline: A letter typed <gap> after the game ends <outcome>
    Given the game ended <gap> ago with a deposit of £50 that makes the high-score table
    When I type "d"
    Then the initials field shows "<field>"

    Examples:
      | gap         | outcome        | field                         |
      | 0.3 seconds | doesn't type   | No letters yet, letter 1 of 3 |
      | 0.7 seconds | types as usual | D, letter 2 of 3              |

  @US-02 @slice-01 @real-io @error @contract-shape:unbounded-preservation @DDD-T4 @DDD-T5
  Scenario: A key held down from play never types
    Given I am holding the D key down as the game ends with a deposit of £50 that makes the high-score table
    When the held key is still repeating 1 second after the game ended
    Then the initials field still shows "No letters yet, letter 1 of 3"

  @US-02 @slice-01 @real-io @error @contract-shape:unbounded-preservation @DDD-T4 @DDD-T8
  Scenario Outline: A letter typed with <modifier> held types nothing, and the game leaves the shortcut to the browser
    Given my deposit of £50 makes the high-score table
    When I type "a" with <modifier> held
    Then the initials field still shows "No letters yet, letter 1 of 3"
    And the game leaves the shortcut to the browser

    Examples:
      | modifier |
      | Ctrl     |
      | Cmd      |
      | Option   |
      | Alt      |

  @US-02 @slice-01 @real-io @error @contract-shape:bounded-change @DDD-T8
  Scenario Outline: The <key> key never starts a browser feature while I sign
    Given my deposit of £50 makes the high-score table
    And I have pressed the <key> key
    When I type "a"
    Then the initials field shows "A, letter 2 of 3"
    And the game keeps the <key> key from the browser

    Examples:
      | key        |
      | slash      |
      | apostrophe |
      | Backspace  |

  # D19: on every screen of the game, not only while I sign (UAT 6's title and play rows).
  @US-02 @slice-01 @real-io @error @contract-shape:unbounded-preservation @DDD-T8
  Scenario Outline: The <key> key never starts a browser feature on the title screen
    Given I have opened the game
    When I press the <key> key
    Then the game keeps the <key> key from the browser

    Examples:
      | key        |
      | slash      |
      | apostrophe |
      | Backspace  |

  @US-02 @slice-01 @real-io @error @contract-shape:unbounded-preservation @DDD-T8
  Scenario Outline: The <key> key never starts a browser feature during play
    Given I have opened the game
    And I have started a new game
    When I press the <key> key
    Then the game keeps the <key> key from the browser

    Examples:
      | key        |
      | slash      |
      | apostrophe |
      | Backspace  |

  # D19, the game-over screen with no entry open (UAT 6's rows): after a deposit that doesn't make a full table (the
  # table holds 10 signatures of £100), after signing MNP and (slice 02) after skipping. One game per situation: the three
  # keys in turn, then Enter, which still starts a new game. Each Examples block is enabled on its own: the first in
  # 01-06, the second in 02-01.
  @US-02 @slice-01 @real-io @error @contract-shape:unbounded-preservation @DDD-T8
  Scenario Outline: The slash, apostrophe and Backspace keys never start a browser feature on the game-over screen <situation>
    Given I am on the game-over screen <situation>
    When I press slash, apostrophe, Backspace and Enter, one after another
    Then the game keeps the slash, apostrophe and Backspace keys from the browser
    And a new game starts

    Examples:
      | situation                                      |
      | after a deposit that doesn't make a full table |
      | after signing                                  |

    @US-05 @slice-02 @pending
    Examples:
      | situation      |
      | after skipping |

  @US-02 @slice-01 @real-io @edge @contract-shape:bounded-change @DDD-T8
  Scenario: The game leaves Enter to the browser, so a focused link can still open with it
    Given my deposit of £50 makes the high-score table
    And I have typed "al"
    When I press Enter
    Then the game leaves Enter to the browser
    And the initials field still shows "A L, letter 3 of 3"
