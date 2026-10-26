Feature: Every rung of the property ladder is a place of its own
  Climbing the property ladder takes a house-hunter from the city centre at dawn to the seaside at night, one
  neighbourhood per rung. The page names the neighbourhood beside the rung, and a screen reader hears where I have
  arrived as every wave after a cleared one starts, Forever home's repeats included. A new game says only that the
  game has started.

  # Played in memory: the game's own rules with the page's real status section, one moment after another, as the game
  # plays them. A wave is cleared by leaving one hurdle with my shot already on it. "Moving up" clears the wave I am
  # playing, lets the "Wave cleared!" banner run out, and plays the next wave for half a second. "I am at ... in ..."
  # reads the rung and the neighbourhood the page names. "I hear only ..." means exactly that, said once during the
  # When, and nothing else; "I hear ..., then ..." exactly those two, once each, in that order.
  # The page already names the neighbourhood (the walking skeleton), so those scenarios run now; the arrival sentence is
  # still to come.

  @in-memory @contract-shape:bounded-change @DDD-B8
  Scenario: Starting a game puts me in the city centre at dawn
    Given the game has just loaded
    When I start climbing the property ladder
    Then I am at "Studio flat", in "City centre at dawn"
    And I hear only "Game started. Defend your dream home from the hurdles."

  @in-memory @property @contract-shape:bounded-change @DDD-B8 @DDD-B12
  Scenario Outline: The <wave> wave is at <rung>, in <neighbourhood>
    Given I have started climbing the property ladder
    When I climb to the <wave> wave
    Then I am at "<rung>", in "<neighbourhood>"

    Examples:
      | wave   | rung          | neighbourhood                   |
      | second | Terrace       | Terraced streets in the morning |
      | third  | Semi-detached | Suburbs at midday               |
      | fourth | Detached      | Leafy avenue in the afternoon   |
      | fifth  | Country pile  | Countryside at sunset           |
      | sixth  | Forever home  | Seaside at night                |

    # Past the top of the ladder, the rung and the neighbourhood stay at Forever home.
    @edge
    Examples:
      | wave    | rung         | neighbourhood    |
      | seventh | Forever home | Seaside at night |
      | tenth   | Forever home | Seaside at night |

  # The approved wording (DDD-B8, the user, 2026-10-26), heard at the start of every wave after a clear, the repeats from
  # Forever home onwards included. "Wave cleared! Moving up the ladder to ..." is unchanged.
  @in-memory @property @contract-shape:bounded-change @DDD-B8
  Scenario Outline: Moving up to the <wave> wave, I hear that I am now at <rung>, in <neighbourhood>
    Given I am playing the <previous> wave
    When I move up to the <wave> wave
    Then I hear "Wave cleared! Moving up the ladder to <rung>.", then "Now on the property ladder at <rung>. <neighbourhood>."

    Examples:
      | previous | wave   | rung          | neighbourhood                   |
      | first    | second | Terrace       | Terraced streets in the morning |
      | second   | third  | Semi-detached | Suburbs at midday               |
      | third    | fourth | Detached      | Leafy avenue in the afternoon   |
      | fourth   | fifth  | Country pile  | Countryside at sunset           |
      | fifth    | sixth  | Forever home  | Seaside at night                |

    @edge
    Examples:
      | previous | wave    | rung         | neighbourhood    |
      | sixth    | seventh | Forever home | Seaside at night |
      | ninth    | tenth   | Forever home | Seaside at night |

  @in-memory @edge @contract-shape:bounded-change @DDD-B8
  Scenario Outline: Where I have arrived isn't said again when I <interruption>
    Given I am playing the second wave
    When I <interruption>
    Then I hear only "<said>"

    Examples:
      | interruption                                 | said                       |
      | pause and resume the game                    | Paused. Press P to resume. |
      | lose a home to a bolt, and my pin comes back | Home lost. 2 left.         |

  @in-memory @edge @contract-shape:bounded-change @DDD-B8 @DDD-B9
  Scenario: Playing again after reaching Country pile starts me in the city centre, without an arrival
    Given I am playing the fifth wave
    And I have lost the game
    When I play again
    Then I am at "Studio flat", in "City centre at dawn"
    And I hear only "Game started. Defend your dream home from the hurdles."

  # The rungs and the neighbourhoods run in the same order and both stop at their last entry: set side by side, each
  # rung meets exactly one neighbourhood and each neighbourhood exactly one rung, with six different names on each side
  # (DDD-B12).
  @in-memory @property @edge @contract-shape:pure-function @DDD-B12
  Scenario: Every rung of the property ladder has a neighbourhood of its own
    When the rungs of the property ladder are set beside the neighbourhoods
    Then every rung has a neighbourhood of its own, and every neighbourhood a rung of its own
