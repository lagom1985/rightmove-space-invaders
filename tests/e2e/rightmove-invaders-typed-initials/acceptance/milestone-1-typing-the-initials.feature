@sizing-review-needed
Feature: Typing my initials (US-01)
  When my deposit makes the shared high-score table, I want to type my initials as I would anywhere else and press
  Enter, so I can claim my place in seconds and get back to playing. The entry opens empty, each letter fills the next
  slot in capitals, Backspace takes back the last one, and Enter signs once all three are in.

  # The deposits are £50: the page driver plays one shot at the Damp above the pin. DISCUSS's ranks are kept by seeding
  # the table (two rows of £1,000 make the £50 #3). The hint is checked without its last word ("Type 3 letters to sign"),
  # so these scenarios hold for slice 01's hint and for slice 02's ("..., or press Esc to skip.").

  @US-01 @slice-01 @kpi @kpi-K16 @real-io @contract-shape:bounded-change
  Scenario: Typed initials sign the table
    Given the high-score table holds 2 signatures of £1,000
    And my deposit of £50 makes the high-score table
    And I have typed "alx"
    When I press Enter
    Then the game tells me "Signing ALX…"
    And the game tells me "Signed ALX, #3."
    And ALX's row on the high-score table is marked as mine

  @US-01 @slice-01 @real-io @contract-shape:bounded-change @DDD-T6
  Scenario: The entry opens empty
    Given the high-score table holds 9 signatures of £1,000
    When I finish a game with a deposit of £50
    Then the game tells me "New high score! Enter your initials: type 3 letters, then press Enter to sign."
    And the game tells me "Deposit saved £50"
    And the initials field shows "No letters yet, letter 1 of 3"

  # "At once" is one frame of the fake clock (17 ms at 60 Hz). Letters typed within one frame are heard together, as the
  # field they leave, so "A, letter 2 of 3" is never heard when "a" and "l" come together.
  @US-01 @slice-01 @real-io @edge @contract-shape:bounded-change @DDD-T10
  Scenario Outline: Letters show, and are heard, as they are typed: "<letters>" <spacing>
    Given my deposit of £50 makes the high-score table
    When I type "<letters>" <spacing>
    Then at once the initials field shows "<field>"
    And the game tells me "<field>"
    And the letters I typed were announced <announcements>

    Examples:
      | letters | spacing          | field              | announcements |
      | a       | within one frame | A, letter 2 of 3   | 1 time        |
      | al      | within one frame | A L, letter 3 of 3 | 1 time        |
      | al      | a frame apart    | A L, letter 3 of 3 | 2 times       |

  @US-01 @slice-01 @real-io @contract-shape:bounded-change
  Scenario: Backspace takes back the last letter
    Given my deposit of £50 makes the high-score table
    And I have typed "alc"
    When I press Backspace
    Then the initials field shows "A L, letter 3 of 3"

  @US-01 @slice-01 @real-io @edge @contract-shape:unbounded-preservation
  Scenario: Backspace on an empty entry does nothing
    Given my deposit of £50 makes the high-score table
    When I press Backspace
    Then the initials field still shows "No letters yet, letter 1 of 3"
    And nothing about the initials is announced

  @US-01 @slice-01 @real-io @error @contract-shape:bounded-change @DDD-T6
  Scenario: Enter with fewer than 3 letters sends nothing
    Given my deposit of £50 makes the high-score table
    And I have typed "al"
    When I press Enter
    Then the game tells me "Type 3 letters to sign"
    And the initials field still shows "A L, letter 3 of 3"
    And nothing is sent to the high-score table

  @US-01 @slice-01 @real-io @error @edge @contract-shape:bounded-change @DDD-T6
  Scenario: Enter pressed again too early gives the hint again
    Given my deposit of £50 makes the high-score table
    And I have typed "al"
    And I have pressed Enter
    When I press Enter
    Then the game has told me "Type 3 letters to sign" twice

  # Notices are numbered across games (DESIGN open question 9): this fails if the numbers restart with each entry.
  @US-01 @slice-01 @real-io @edge @contract-shape:bounded-change @DDD-T6 @DDD-T10
  Scenario: Enter pressed too early in my next game gives the hint again
    Given my deposit of £50 makes the high-score table
    And I have typed "al"
    And I have pressed Enter
    And I have signed by typing "x" and pressing Enter
    And I have started a new game
    And my deposit of £50 makes the high-score table
    When I press Enter
    Then the game has told me "Type 3 letters to sign" twice

  @US-01 @slice-01 @real-io @edge @contract-shape:unbounded-preservation
  Scenario: A fourth letter changes nothing
    Given my deposit of £50 makes the high-score table
    And I have typed "alx"
    When I type "q"
    Then the initials field still shows "A L X, press Enter to sign"
    And nothing about the initials is announced

  # UAT 7's second example, and the same for a letter in the middle and for Backspace. A key held down repeats; only its
  # first press acts, so a repeat that typed would sign "AAA", "AXX" or too few letters instead.
  @US-01 @slice-01 @real-io @edge @contract-shape:bounded-change @DDD-T4
  Scenario Outline: Holding <key> down for a second acts on the initials once: "<before>", then "<after>"
    Given my deposit of £50 makes the high-score table
    And I have typed "<before>"
    And I have held the <key> key down for a second
    And I have typed "<after>"
    When I press Enter
    Then the game tells me "<signing>"

    Examples:
      | before | key       | after | signing      |
      |        | A         | lx    | Signing ALX… |
      | a      | X         | q     | Signing AXQ… |
      | alx    | Backspace | c     | Signing ALC… |

  @US-01 @slice-01 @kpi @kpi-K17 @real-io @edge @contract-shape:bounded-change @DDD-T1
  Scenario: Fast typing keeps every letter, in order
    Given my deposit of £50 makes the high-score table
    When I type "aax" and press Enter, all within one frame
    Then the game tells me "Signing AAX…"

  # D20, DDD-T1: the entry stays open with its letters, and nothing is typed while the game lacks focus. A key pressed in
  # the very instant the game is left is still waiting for the next frame, and is dropped with the keys held down.
  @US-01 @slice-01 @real-io @edge @contract-shape:bounded-change @DDD-T1 @pending
  Scenario Outline: My letters stay when I <leaving> mid-entry, and a key caught by it doesn't count
    Given my deposit of £50 makes the high-score table
    And I have typed "a"
    And I pressed "l" just as I <leaving>
    And I have come back to the game
    When I type "x"
    Then the initials field shows "A X, letter 3 of 3"

    Examples:
      | leaving                    |
      | switched to another window |
      | hid the game's tab         |
