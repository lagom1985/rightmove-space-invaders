Feature: Everything I need to see stays readable on every neighbourhood
  The neighbourhoods are dark and quiet, so the hurdles, my pin, the houses and every word drawn over them keep the
  contrast they need, more for text than for the things I play against, on every colour of every neighbourhood, each
  taken a shade brighter for the softened edges of shapes.

  # Measured on the game's own colours alone, every pair, never a sample and never the picture (ADR-011, DDD-B6 and
  # DDD-B7). "Stands out" is the contrast the accessibility guidelines measure: "as much as text needs to" is their
  # minimum for text, "as much as something I play against needs to" their lower minimum for shapes. "A backdrop may be"
  # no brighter than the limit the spike found, and "a shade brighter" is how much brighter the softened edge of a shape,
  # or a moment of the fade, can come out. The uses and their needs are DESIGN's Legibility needs table. A failure lists
  # every pair that falls short, by neighbourhood and colour.
  # These already hold, except where the Dream home's pink is measured (still to come, below): they guard the
  # neighbourhoods' colours from now on.

  @in-memory @property @contract-shape:pure-function @DDD-B6
  Scenario: No neighbourhood has a colour brighter than a backdrop may be
    When every colour of every neighbourhood is measured
    Then no colour is brighter than a backdrop may be

  @in-memory @property @contract-shape:pure-function @DDD-B6
  Scenario Outline: Every neighbourhood leaves <use> readable
    When <use> is measured against every colour of every neighbourhood, a shade brighter
    Then each stands out as much as <need> needs to, against every one

    Examples:
      | use                                       | need                     |
      | the HUD's labels and the small grey text  | text                     |
      | the HUD's values and the white text       | text                     |
      | the green text, the pin and the shot      | text                     |
      | the hurdles, their bolts and their sparks | something I play against |
      | the houses' brick and windows             | something I play against |

    # The small "Dream home saved +£..." text falls just short today, on Leafy avenue's road and on Terraced streets'
    # road. DELIVER darkens those two road colours, never the Dream home's pink (DDD-B6, ADR-011), then runs this row.
    Examples:
      | use                                    | need |
      | the Dream home text and the Dream Home | text |

  # Each name in the title's legend is drawn on a dark outline, so it is measured against the outline, whatever
  # neighbourhood is behind it: no name is excused, Gazumper's included (DDD-B7).
  @in-memory @property @edge @contract-shape:pure-function @DDD-B6 @DDD-B7 @DDD-B9
  Scenario: The names in the title's legend stay readable on their outline
    When the names in the title's legend are measured against the outline they are drawn on
    Then every name stands out as much as text needs to

  # Every colour the game draws over a backdrop is measured against every colour of every neighbourhood, by the
  # strictest need of its uses, or excused by name, never both and never neither. It waits with the Dream home row: the
  # Dream home's pink falls short on two roads today.
  @in-memory @error @contract-shape:pure-function @DDD-B6 @DDD-B7
  Scenario: Every colour the game draws over a backdrop stands out as much as its use needs, or is excused by name
    When every colour the game draws over a backdrop is measured against every colour of every neighbourhood, a shade brighter
    Then each stands out as much as its use needs, except the houses' door, which no colour can fix, the game-over red, which is drawn only on the game-over screen, the outline round the title's names, which is there to set them off, and the veils of the paused and game-over screens, which only darken
