Feature: A long game still signs, in the usual time
  A good run can last most of an hour, and its record grows with it. The table takes any honest record of up to 60
  minutes of game time at a human pace, replays it in time, and refuses anything longer or larger without replaying it.

  # Its session was issued as long before as the game lasted, as a real one would have been (the clock check, slice 03).
  @pending @US-04 @D9 @DDD-R3 @DDD-R9 @server @real-io @kpi-K21 @kpi-K22
  Scenario: The longest recorded game signs, and is saved with its deposit
    Given nobody has signed the high-score table yet
    When the longest recorded game signs PRI, as long after its session was issued as it lasted
    Then the signature is saved as one new row
    And the answer shows PRI's new row at #1
    And the owner can see the game was replayed, and how long the replay took

  # A record of standing still: its replay ends at game over within minutes, so it is refused, but only after a replay.
  @pending @US-04 @D9 @DDD-R5 @DDD-R14 @server @real-io @error @edge @kpi-K20
  Scenario Outline: A record of <length> of standing still is <what happens>
    Given nobody has signed the high-score table yet
    When a signing of £50 arrives with a record of <length> of standing still, its session issued over an hour before
    Then the signature is refused <why>
    And the owner can see the game was <replayed>
    And the table is left as it was

    Examples:
      | length                  | what happens                           | why                       | replayed                               |
      | exactly 60 minutes      | read, and played back                  | as not the game it claims | replayed, and how long the replay took |
      | 60 minutes and one step | refused, without a replay, as too long | as longer than an hour    | never replayed                         |

  # Its made-up changes end the game within minutes, so it is refused, but only after it was read whole and played back.
  # No local scenario plays back an honest 60-minute game: none exists. K22's 60-minute figure is S7's, on a preview.
  @pending @US-04 @D9 @D20 @DDD-R3 @server @real-io @edge @kpi-K22
  Scenario: The largest record a human could make in an hour is read and played back, not refused as too long
    Given nobody has signed the high-score table yet
    When a signing of £50 arrives with an hour's record of 15 changes of keys a second, spaced to take the most room, its session issued over an hour before
    Then the signature is refused as not the game it claims
    And the owner can see the game was replayed, and how long the replay took

  @pending @US-04 @DDD-R3 @server @real-io @error @edge @kpi-K20
  Scenario Outline: A signing of <size> is <what happens>
    Given the high-score table holds KIM with £2,000
    When Alex's game signs ALX with £1,250, carrying its session, the signing padded to <size>
    Then <outcome>

    Examples:
      | size                | what happens | outcome                                 |
      | exactly 128 KB      | saved        | the signature is saved as one new row   |
      | 128 KB and one byte | refused      | the signature is refused as too long    |

  # The handler's own limit. On Netlify a body over 6 MB is refused by the platform before the function runs (DEVOPS),
  # so this scenario has no Netlify twin.
  @pending @US-04 @DDD-R3 @server @real-io @error @kpi-K20
  Scenario: The table stops reading a signing soon after its limit
    Given the high-score table holds KIM with £2,000
    When a signing of 10 MB arrives
    Then the signature is refused as too long
    And the table stopped reading it soon after its limit
    And the table is left as it was
