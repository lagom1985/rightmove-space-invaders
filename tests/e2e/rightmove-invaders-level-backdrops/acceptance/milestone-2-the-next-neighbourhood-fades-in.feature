Feature: The next neighbourhood fades in while "Wave cleared!" shows
  When I clear a wave, the next rung's neighbourhood fades in over the one I am leaving for as long as the "Wave
  cleared!" banner shows, 2.4 seconds. From Forever home onwards there is no next place, so nothing fades in. The title
  shows the first rung's neighbourhood, and a new game goes straight back to it.

  # Played in memory, as "Every rung of the property ladder is a place of its own" is. "The backdrop shows ..." is what
  # the screen is to show behind the game at the end of the When (DDD-B5): the neighbourhood underneath, the one fading
  # in over it, and how strongly, to the nearest twentieth of a percent. How the screen then draws it is "The game plays
  # on smoothly"'s; the picture itself is never read. Whether the game is paused makes no difference to what is shown.

  @in-memory @pending @contract-shape:unbounded-preservation @DDD-B5 @DDD-B9
  Scenario: The title shows the city centre at dawn, with nothing fading in
    When the game loads
    Then the backdrop shows City centre at dawn, with nothing fading in

  @in-memory @pending @contract-shape:unbounded-preservation @DDD-B5
  Scenario: Starting a game keeps the city centre at dawn, with nothing fading in
    Given the game has just loaded
    When I start climbing the property ladder
    Then the backdrop shows City centre at dawn, with nothing fading in

  @in-memory @pending @contract-shape:unbounded-preservation @DDD-B5
  Scenario: Clearing a wave starts the next neighbourhood fading in, from nothing
    Given I have started climbing the property ladder
    When I clear the first wave
    Then the backdrop shows City centre at dawn, with Terraced streets in the morning faded in to 0%

  @in-memory @pending @property @contract-shape:unbounded-preservation @DDD-B5
  Scenario Outline: Half way through "Wave cleared!" on the <wave> wave, the backdrop shows <here>, with <fade>
    Given I am playing the <wave> wave
    And I have cleared the <wave> wave
    When 1.2 seconds of the banner pass
    Then the backdrop shows <here>, with <fade>

    Examples:
      | wave   | here                            | fade                                            |
      | first  | City centre at dawn             | Terraced streets in the morning faded in to 50% |
      | second | Terraced streets in the morning | Suburbs at midday faded in to 50%               |
      | third  | Suburbs at midday               | Leafy avenue in the afternoon faded in to 50%   |
      | fourth | Leafy avenue in the afternoon   | Countryside at sunset faded in to 50%           |
      | fifth  | Countryside at sunset           | Seaside at night faded in to 50%                |

    # At Forever home and past it, the next rung would be the same place.
    @edge
    Examples:
      | wave    | here             | fade              |
      | sixth   | Seaside at night | nothing fading in |
      | seventh | Seaside at night | nothing fading in |
      | tenth   | Seaside at night | nothing fading in |

  # The last moments of the banner are near full strength, never full: the next wave starts instead.
  @in-memory @pending @contract-shape:unbounded-preservation @DDD-B5
  Scenario Outline: <passed> seconds into "Wave cleared!", the next neighbourhood has faded in to <strength>
    Given I am playing the first wave
    And I have cleared the first wave
    When <passed> seconds of the banner pass
    Then the backdrop shows City centre at dawn, with Terraced streets in the morning faded in to <strength>

    Examples:
      | passed | strength |
      | 0.6    | 25%      |
      | 1.8    | 75%      |
      | 2.35   | 97.9%    |

  # Moments the game itself never reaches: the banner already run out, or longer than it ever is. The fade stays at its
  # ends.
  @in-memory @pending @edge @error @contract-shape:pure-function @DDD-B5
  Scenario Outline: "Wave cleared!" with <left> seconds of the banner left holds the fade at <strength>
    When "Wave cleared!" shows on the first wave with <left> seconds of the banner left
    Then the backdrop shows City centre at dawn, with Terraced streets in the morning faded in to <strength>

    Examples:
      | left | strength |
      | -0.5 | 100%     |
      | 3    | 0%       |

  @in-memory @pending @edge @contract-shape:unbounded-preservation @DDD-B5
  Scenario: Pausing mid-fade holds the fade where it is
    Given I am playing the first wave
    And I have cleared the first wave
    And 1.2 seconds of the banner have passed
    When I pause the game for 10 seconds
    Then the backdrop still shows City centre at dawn, with Terraced streets in the morning faded in to 50%

  @in-memory @pending @contract-shape:unbounded-preservation @DDD-B5
  Scenario: When the banner ends, I am in the next neighbourhood, with nothing fading in
    Given I am playing the first wave
    And I have cleared the first wave
    When the banner ends
    Then the backdrop shows Terraced streets in the morning, with nothing fading in

  @in-memory @pending @edge @contract-shape:unbounded-preservation @DDD-B5
  Scenario: Losing a home fades nothing in
    Given I am playing the second wave
    When I lose a home to a bolt
    Then the backdrop shows Terraced streets in the morning, with nothing fading in

  @in-memory @pending @edge @contract-shape:unbounded-preservation @DDD-B5
  Scenario: The game-over screen shows the neighbourhood I reached
    Given I am playing the fifth wave
    When I lose the game
    Then the backdrop shows Countryside at sunset, with nothing fading in

  @in-memory @pending @edge @contract-shape:unbounded-preservation @DDD-B5 @DDD-B9
  Scenario: Playing again from a higher rung goes straight back to the city centre at dawn
    Given I am playing the fifth wave
    And I have lost the game
    When I play again
    Then the backdrop shows City centre at dawn, with nothing fading in
