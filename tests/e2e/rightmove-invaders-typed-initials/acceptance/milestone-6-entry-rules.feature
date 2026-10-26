Feature: My initials follow the rules, whatever I type
  These scenarios try the initials entry with far more typing than anyone could do by hand: every key a keyboard can
  report, any number of them at once, over any number of games, and the exact moment 0.6 seconds after a game ends.
  They play the game's rules on their own, handing them each moment's key presses as the page does.

  # The four properties have no Given on purpose: each of their runs builds its own game, so a Given that arranged one
  # game would apply to none of them. Each run starts from a fresh game whose £50 has just made an empty table; the first
  # three also let the first 0.6 seconds pass. "In one go" is one frame of the game. Around every frame that starts with
  # the entry open, nothing in the game may change but the entry, the skip and the signing (DESIGN open question 10).

  @US-01 @US-02 @slice-01 @in-memory @property @contract-shape:bounded-change @DDD-T3 @DDD-T6
  Scenario: Whatever I type, my initials are the first three letters, in capitals, less any I took back
    When I type any keys at all, as fast or as slowly as I like, once the first 0.6 seconds are over
    Then my initials are always the first three letters typed, in capitals, less those taken back with Backspace

  @US-02 @US-03 @slice-01 @in-memory @property @error @contract-shape:unbounded-preservation @DDD-T3
  Scenario: A key that isn't a letter A to Z never changes my initials
    When I press any key that isn't a letter A to Z, after typing up to three letters
    Then my initials never change, and nothing is announced or sent

  @US-01 @US-04 @slice-01 @in-memory @property @error @contract-shape:bounded-change @DDD-T3 @pending
  Scenario: Only three letters A to Z, never on the word filter, ever leave for the table
    When I type anything and press Enter, over any number of games
    Then only three letters A to Z, never on the word filter, ever leave for the high-score table

  # Includes Esc, so it is enabled with slice 02 (in slice 01, Esc is a key the entry ignores).
  @US-01 @US-02 @US-04 @US-05 @slice-02 @in-memory @property @contract-shape:bounded-change @DDD-T2 @DDD-T5 @DDD-T6 @DDD-T7 @pending
  Scenario: Whatever I type, press and wait whenever a game ends, the entry and the game keys follow the rules
    When I type, press keys and wait in any order whenever a game ends, over any number of games
    Then my initials, my signing, the skip and the game keys always follow the rules

  # 0.6 s is the boundary itself: the game has been over for exactly 0.6 s (0 + 0.6 is exactly 0.6), and keys are still
  # dropped; 0.61 s is past it. Each Examples block is enabled on its own: the slice-01 rows in 01-05, Esc in 02-01.
  @US-02 @slice-01 @in-memory @error @edge @contract-shape:bounded-change @DDD-T5
  Scenario Outline: <keys> pressed <gap> after the game ends <outcome>
    Given my game has ended with a deposit that makes the table, on the game's rules alone
    And the game ended exactly <gap> ago
    When I press "<keys>" in one go
    Then my initials are "<initials>", with <notice>
    And nothing else in the game changed

    @pending
    Examples:
      | keys  | gap          | outcome         | initials | notice           |
      | a     | 0.6 seconds  | is dropped      |          | no notice        |
      | Enter | 0.6 seconds  | is dropped      |          | no notice        |
      | a     | 0.61 seconds | counts          | A        | no notice        |
      | Enter | 0.61 seconds | counts          |          | the too-few hint |

    @US-05 @slice-02 @pending
    Examples:
      | keys  | gap          | outcome         | initials | notice           |
      | Esc   | 0.6 seconds  | is dropped      |          | no notice        |

  @US-04 @slice-01 @in-memory @edge @contract-shape:unbounded-preservation @DDD-T6 @pending
  Scenario: A key the entry ignores leaves the refusal on show
    Given my game has ended with a deposit that makes the table, on the game's rules alone
    And the rules have refused initials on the word filter
    When I press "Up" in one go
    Then my initials are "", with the refusal
    And nothing else in the game changed

  @US-01 @US-02 @slice-01 @in-memory @edge @contract-shape:bounded-change @DDD-T2
  Scenario: Keys after the Enter that signs, in the same go, are dropped
    Given my game has ended with a deposit that makes the table, on the game's rules alone
    And the game ended exactly 1 second ago
    When I press "a l x Enter m Enter" in one go
    Then only ALX has left for the high-score table
    And no game key took effect
    And nothing else in the game changed
