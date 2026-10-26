Feature: The letter printed on my key is the letter I sign (US-03)
  The initials are the letters printed on the keys I press, on UK and US QWERTY, French AZERTY and German QWERTZ, in
  capitals however I type them. Letters outside A to Z are ignored, never turned into a plain letter.

  # Playwright presses keys as a US QWERTY keyboard does (every other scenario of this feature types that way). The other
  # layouts are stood in for by the key events their keyboards send: the letter printed on the key, at the key's position
  # (AZERTY's A where QWERTY has Q). The DISTILL probe checked that the game receives them in Chromium, Firefox and
  # WebKit. A real AZERTY or QWERTZ keyboard is a manual check in DELIVER (DoD 5).

  @US-03 @slice-01 @kpi @kpi-K17 @real-io @contract-shape:bounded-change @DDD-T1 @DDD-T11 @pending
  Scenario: Letters on a French AZERTY keyboard
    Given my keyboard is French AZERTY
    And my deposit of £50 makes the high-score table
    And I have pressed the keys printed "CAM"
    When I press Enter
    Then the game tells me "Signing CAM…"

  @US-03 @slice-01 @kpi @kpi-K17 @real-io @contract-shape:bounded-change @DDD-T1 @DDD-T11 @pending
  Scenario: Letters on a German QWERTZ keyboard
    Given my keyboard is German QWERTZ
    And my deposit of £50 makes the high-score table
    And I have pressed the keys printed "JAZ"
    When I press Enter
    Then the game tells me "Signing JAZ…"

  # Each character sent as itself, by the key of its own layout that types it (å from a Swedish keyboard's own key, as
  # well as through Option in milestone 2). None is A to Z, and none is turned into a plain letter.
  @US-03 @slice-01 @real-io @error @contract-shape:unbounded-preservation @DDD-T3 @DDD-T11 @pending
  Scenario Outline: The key that types <character> on a <layout> keyboard types nothing
    Given my keyboard is <layout>
    And my deposit of £50 makes the high-score table
    When I press the key that types "<character>"
    Then the initials field still shows "No letters yet, letter 1 of 3"
    And nothing about the initials is announced

    Examples:
      | layout        | character |
      | French AZERTY | é         |
      | German QWERTZ | ü         |
      | German QWERTZ | ß         |
      | Swedish       | å         |

  # UAT 4's three ways (with Shift held, with Caps Lock on, on its own), in one game: each gives the capital letter.
  @US-03 @slice-01 @real-io @edge @contract-shape:bounded-change @DDD-T3 @pending
  Scenario: Capitals, however they are typed
    Given my deposit of £50 makes the high-score table
    When I type "C" with Shift held, "A" with Caps Lock on and a plain "m"
    Then the initials field shows "C A M, press Enter to sign"
