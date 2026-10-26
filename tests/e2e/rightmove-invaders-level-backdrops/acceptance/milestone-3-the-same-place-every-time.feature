Feature: Each neighbourhood looks the same every time, in its own colours
  A neighbourhood's map and skyline come from its own fixed recipe, so it looks the same on every visit and in every
  browser, and drawing it never changes the game the hurdles play. It is drawn only in its own colours, which is what
  keeps everything in front of it readable.

  # Played in memory (DDD-B2): each neighbourhood is drawn on a stand-in for the screen that keeps what is drawn and in
  # which colours, never the picture, and turns away anything a neighbourhood has no need of, a change of size
  # included. "The game's luck" is the chance behind the hurdles' fire and the Dream Home's timing: while it can't be
  # used, any reach for it fails and is counted. "Drawn in full" means drawn without failing and without anything turned
  # away. Its streets are whatever is drawn in its road colour, its skyline whatever is filled in its sky colour (only
  # skylines use it).
  # A deliberate exception: every Then below also holds two guards it doesn't name, the reaches for the game's luck and
  # the requests turned away, which must both stay at none. They count across all six neighbourhoods, and they ride on
  # every Then so that a neighbourhood reaching for either fails each scenario, not only the one that names it.

  @in-memory @pending @property @error @contract-shape:unbounded-preservation @DDD-B2
  Scenario: Drawing every neighbourhood leaves the game's luck alone
    Given the game's luck can't be used
    When every neighbourhood is drawn
    Then every neighbourhood is drawn in full, and the game's luck is never asked for

  @in-memory @pending @property @contract-shape:bounded-change @DDD-B2
  Scenario: Every neighbourhood is drawn exactly the same way every time
    Given the game's luck can't be used
    And every neighbourhood has been drawn once
    When every neighbourhood is drawn again
    Then each neighbourhood is drawn exactly as it was the first time

  @in-memory @pending @property @error @contract-shape:bounded-change @DDD-B1
  Scenario: Every neighbourhood is drawn only in its own colours, and the green of the ground line
    Given the game's luck can't be used
    When every neighbourhood is drawn
    Then each neighbourhood is drawn only in its own colours, and green for the ground line

  @in-memory @pending @property @contract-shape:bounded-change @DDD-B1
  Scenario: Every neighbourhood has its streets and its skyline
    Given the game's luck can't be used
    When every neighbourhood is drawn
    Then each neighbourhood has its streets, in its road colour, and its skyline, in its sky colour
