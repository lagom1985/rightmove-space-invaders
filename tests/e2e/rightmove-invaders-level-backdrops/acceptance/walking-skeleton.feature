Feature: A neighbourhood for every rung of the property ladder
  A house-hunter climbing the property ladder sees each rung as a different place: its own neighbourhood map, time of
  day and skyline. Moving up a rung fades the next neighbourhood in while "Wave cleared!" shows.

  # The first wave is played for real on the seeded game, by sheltering under the middle houses (spike findings), so the
  # scenario takes about a minute of game time.
  @walking_skeleton @driving_port @timeout:120000
  Scenario: Clearing the first wave moves the house-hunter from the city centre to terraced streets
    Given I start a game on the first rung of the property ladder
    Then the neighbourhood is "City centre at dawn"
    When I clear the first wave by sheltering under the middle houses
    Then I have moved up the property ladder to "Terrace"
    And the neighbourhood is "Terraced streets in the morning"
