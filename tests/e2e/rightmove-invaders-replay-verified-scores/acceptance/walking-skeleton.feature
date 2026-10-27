Feature: The high-score table keeps only games that were played
  The shared high-score table stops trusting the deposit a browser claims. Every game asks the table for a session as
  it starts and signs with it, and the table turns away a signing that no game asked for, so a deposit typed into a
  terminal never reaches the table. The leaderboard's walking skeleton ("A house-hunter signs the high-score table and
  another house-hunter sees it") is this feature's too: its game now asks for a session and signs with it, with no step
  changed. This scenario adds the table's own side: the 2026-10-26 forgery, sent with no game at all.

  # Slice 01's first scenario. The real function and the real Blobs client, on the emulator, through the handler (the
  # build gate). @pending until DELIVER's first step: today the table saves it.
  @pending @walking_skeleton @driving_port @server @real-io @error @US-01 @D6 @DDD-R3 @DDD-R14 @kpi-K20
  Scenario: The owner's table turns away a signing that no game asked for
    Given the high-score table holds KIM with £2,000
    When the high-score table receives HAX's signature of £249,950 with no session
    Then the signature is refused as having no session
    And the owner can see why it was refused
    And what the owner sees says nothing about the player
    And the table is left as it was
