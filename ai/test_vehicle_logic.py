import unittest

from decision import decide_action
from vehicle_logic import estimate_distance


class DecisionTests(unittest.TestCase):
    def test_person_inside_two_meters_brakes(self):
        self.assertEqual(decide_action("person", 1.5), "BRAKE")

    def test_person_far_away_moves(self):
        self.assertEqual(decide_action("person", 2.5), "MOVE")

    def test_car_inside_three_meters_stops(self):
        self.assertEqual(decide_action("car", 2.9), "STOP")

    def test_bicycle_inside_two_meters_slows(self):
        self.assertEqual(decide_action("bicycle", 1.9), "SLOW")

    def test_unknown_objects_move(self):
        self.assertEqual(decide_action("traffic light", 0.5), "MOVE")


class DistanceTests(unittest.TestCase):
    def test_estimates_distance_in_meters(self):
        self.assertEqual(estimate_distance(350), 1.0)

    def test_avoids_division_by_zero(self):
        self.assertEqual(estimate_distance(0), 350.0)


if __name__ == "__main__":
    unittest.main()
