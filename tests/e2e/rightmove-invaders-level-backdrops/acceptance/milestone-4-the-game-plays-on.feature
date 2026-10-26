Feature: The game plays on smoothly, whatever a backdrop costs
  Preparing a neighbourhood's backdrop takes a fraction of a second, too long to do over and over. So the screen prepares a
  backdrop once for the game's size, keeps the two it showed last, and prepares one only as its neighbourhood first
  appears. If a backdrop can't be prepared at all, that rung shows its plain background colour, and the game plays on.

  # Played in memory, through the screen's own backdrop parts, called directly (DDD-B3, DDD-B4 and DDD-B5; the test
  # policy's recorded deviation, the user's choice of 2026-10-26). "Preparing" a backdrop is making its picture for the
  # game's size, scaled to that size before anything is drawn on it. Each moment, the screen draws what the game asks for
  # behind it: "X is shown" is one moment with X alone; "the screen draws X, with ..." one moment with that fading in
  # over X. What I see is read off what the screen was asked to draw, never the picture: X's own backdrop, or X's plain
  # background colour, each over the whole screen at the strength it was drawn with. Every Then also holds that, during
  # the When, nothing went wrong out loud (no failure passed on to the game, nothing reported), nothing was asked of the
  # screen that it doesn't offer, and the strength was put back as it was found; "nothing reported" in a Then also means
  # none of these has happened since the screen first drew.
  # The screen can have no room for another backdrop, as when the browser can't spare the memory, or lose its drawing
  # part-way through one; "but the first" and "one more only" count the backdrops prepared from then on, the
  # neighbourhood underneath first, then the one fading in. "Double size" and "triple size" are how large the window
  # shows the game. That the game's own screen uses these same parts is checked by hand.

  @in-memory @contract-shape:bounded-change @DDD-B3
  Scenario: A neighbourhood is prepared once, however long it is shown
    Given the game is shown at double size
    When City centre at dawn is shown for 10 seconds
    Then City centre at dawn was prepared once, at double size

  # The least recently shown goes first: after City centre, Terraced streets, City centre again, Suburbs drops Terraced
  # streets, not City centre.
  @in-memory @edge @contract-shape:bounded-change @DDD-B3
  Scenario: The screen keeps the two neighbourhoods it showed last
    Given the game is shown at double size
    When City centre at dawn, Terraced streets in the morning, City centre at dawn, Suburbs at midday, City centre at dawn and Terraced streets in the morning are shown in turn
    Then the neighbourhoods prepared were City centre at dawn, Terraced streets in the morning, Suburbs at midday and Terraced streets in the morning

  # The shell's composition (DESIGN's composition table, DDD-B5): the neighbourhood underneath at full strength, then the
  # one fading in at the fade's strength; a backdrop that couldn't be prepared is its plain background, at the same
  # strength. Asked for in that order, on a screen that has prepared nothing yet.
  @in-memory @contract-shape:bounded-change @DDD-B4 @DDD-B5
  Scenario Outline: When the screen <trouble>, I see <underneath>, with <over it>
    Given the game is shown at double size
    And the screen <trouble>
    When the screen draws City centre at dawn, with <fade>
    Then I see <underneath>, with <over it>

    Examples:
      | trouble                     | fade                                            | underneath                     | over it                                                     |
      | has room for every backdrop | nothing fading in                               | City centre at dawn's backdrop | nothing over it                                             |
      | has room for every backdrop | Terraced streets in the morning faded in to 50% | City centre at dawn's backdrop | Terraced streets in the morning's backdrop over it at 50%   |

    @error
    Examples:
      | trouble                                   | fade                                            | underneath                             | over it                                                           |
      | has no room for another backdrop          | nothing fading in                               | City centre at dawn's plain background | nothing over it                                                   |
      | has room for one more backdrop only       | Terraced streets in the morning faded in to 50% | City centre at dawn's backdrop         | Terraced streets in the morning's plain background over it at 50% |
      | has room for every backdrop but the first | Terraced streets in the morning faded in to 50% | City centre at dawn's plain background | Terraced streets in the morning's backdrop over it at 50%         |
      | has no room for another backdrop          | Terraced streets in the morning faded in to 50% | City centre at dawn's plain background | Terraced streets in the morning's plain background over it at 50% |

  @in-memory @error @contract-shape:bounded-change @DDD-B4
  Scenario Outline: When the screen <trouble>, the neighbourhood shows its plain background and the game plays on
    Given the game is shown at double size
    And the screen <trouble>
    When Terraced streets in the morning is shown
    Then Terraced streets in the morning shows its plain background, and the game plays on with nothing reported

    Examples:
      | trouble                                       |
      | has no room for another backdrop              |
      | loses its drawing part-way through a backdrop |

  # The first backdrop the game prepares, the title's, is its probe (DDD-B4): when it fails, the rung shows its plain
  # background, and a game still starts on it.
  @in-memory @error @contract-shape:bounded-change @DDD-B4 @DDD-B9
  Scenario: The title's backdrop can't be prepared, and the game still starts and plays
    Given the game is shown at double size
    And the screen has no room for another backdrop
    And the game has just loaded
    When I start climbing the property ladder
    Then I hear only "Game started. Defend your dream home from the hurdles."
    And I am at "Studio flat", in "City centre at dawn"
    And City centre at dawn shows its plain background, and the game plays on with nothing reported

  @in-memory @error @contract-shape:bounded-change @DDD-B4
  Scenario: A backdrop that couldn't be prepared doesn't stop the next one
    Given the game is shown at double size
    And the screen has room for every backdrop but the first
    When Terraced streets in the morning and Suburbs at midday are shown in turn
    Then Terraced streets in the morning shows its plain background, and Suburbs at midday shows its backdrop

  # A backdrop that couldn't be prepared is remembered apart from the two kept (DDD-B4): it never takes the place of one,
  # and showing others never makes the screen forget it and try it again.
  @in-memory @pending @error @contract-shape:bounded-change @DDD-B3 @DDD-B4
  Scenario: A backdrop that couldn't be prepared takes no room from the two kept, however many others are shown
    Given the game is shown at double size
    And the screen has no room for another backdrop
    And Terraced streets in the morning has been shown with its plain background
    And the screen has room again
    When City centre at dawn, Suburbs at midday, Leafy avenue in the afternoon, Terraced streets in the morning, Suburbs at midday and Leafy avenue in the afternoon are shown in turn
    Then the neighbourhoods prepared were City centre at dawn, Suburbs at midday and Leafy avenue in the afternoon

  # Room again, so that a backdrop tried again would come out whole: it isn't tried until the game's size changes.
  @in-memory @pending @error @contract-shape:bounded-change @DDD-B4
  Scenario: A backdrop that couldn't be prepared isn't tried again until the game's size changes
    Given the game is shown at double size
    And the screen has no room for another backdrop
    And Terraced streets in the morning has been shown with its plain background
    And the screen has room again
    When Terraced streets in the morning is shown for 10 seconds
    Then Terraced streets in the morning was not prepared again, and still shows its plain background

  @in-memory @pending @error @contract-shape:bounded-change @DDD-B3 @DDD-B4
  Scenario: Resizing the window without changing the game's size doesn't try a backdrop that couldn't be prepared again
    Given the game is shown at double size
    And the screen has no room for another backdrop
    And Terraced streets in the morning has been shown with its plain background
    And the screen has room again
    When the window is resized but keeps the game at double size, with Terraced streets in the morning on screen
    Then Terraced streets in the morning was not prepared again, and still shows its plain background

  @in-memory @pending @error @contract-shape:bounded-change @DDD-B3 @DDD-B4
  Scenario: Resizing the window to a new size tries a backdrop that couldn't be prepared again
    Given the game is shown at double size
    And the screen has no room for another backdrop
    And Terraced streets in the morning has been shown with its plain background
    And the screen has room again
    When the window is resized to triple size with Terraced streets in the morning on screen
    Then Terraced streets in the morning was prepared once more, at triple size, and shows its backdrop

  # "On screen" is a second with the first neighbourhood underneath and the second fading in over it.
  @in-memory @edge @contract-shape:bounded-change @DDD-B3
  Scenario: Resizing the window without changing the game's size keeps the backdrops it has
    Given the game is shown at double size
    And City centre at dawn and Terraced streets in the morning have been shown in turn
    When the window is resized but keeps the game at double size, with City centre at dawn and Terraced streets in the morning on screen
    Then City centre at dawn and Terraced streets in the morning were not prepared again, and still show their backdrops

  @in-memory @edge @contract-shape:bounded-change @DDD-B3
  Scenario: Resizing the window to a new size prepares the neighbourhoods on screen again, once each
    Given the game is shown at double size
    And City centre at dawn and Terraced streets in the morning have been shown in turn
    When the window is resized to triple size with City centre at dawn and Terraced streets in the morning on screen
    Then City centre at dawn and Terraced streets in the morning were each prepared once more, at triple size

  # The whole climb from the title, played in memory, the screen drawing behind every moment of it. Each moment is named
  # by what the page says on it; a backdrop prepared at any other moment would be named after that moment and fail the
  # table.
  @in-memory @property @contract-shape:bounded-change @DDD-B3 @DDD-B5
  Scenario: Over a whole climb, each neighbourhood is prepared only as it first appears
    Given the game is shown at double size
    When I climb to the seventh wave
    Then neighbourhoods were prepared only at these moments, at double size:
      | neighbourhood                   | moment                                        |
      | City centre at dawn             | as the title appears                          |
      | Terraced streets in the morning | as "Wave cleared!" appears on the first wave  |
      | Suburbs at midday               | as "Wave cleared!" appears on the second wave |
      | Leafy avenue in the afternoon   | as "Wave cleared!" appears on the third wave  |
      | Countryside at sunset           | as "Wave cleared!" appears on the fourth wave |
      | Seaside at night                | as "Wave cleared!" appears on the fifth wave  |

  # The screen keeps two backdrops, so the city centre was let go during the climb, and a new game prepares it again:
  # the one moment a backdrop is prepared while I may be moving, and the quickest of the six to prepare (DDD-B3).
  @in-memory @edge @contract-shape:bounded-change @DDD-B3
  Scenario: Playing again after a long climb prepares the city centre at dawn once more, as the new game starts
    Given the game is shown at double size
    And I am playing the seventh wave
    And I have lost the game
    When I play again
    Then City centre at dawn was prepared once more, at double size, as the new game starts

  @in-memory @edge @contract-shape:bounded-change @DDD-B3
  Scenario: Resizing the window mid-fade prepares both neighbourhoods again, once each
    Given the game is shown at double size
    And I am playing the first wave
    And I have cleared the first wave
    When the window is resized to triple size half way through the banner
    Then City centre at dawn and Terraced streets in the morning were each prepared once more, at triple size
