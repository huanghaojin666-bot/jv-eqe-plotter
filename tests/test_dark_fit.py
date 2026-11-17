"""Numerical and validation checks for the original-engine web adapter."""
import copy
import json
from pathlib import Path
import sys
import unittest

ENGINE = Path(__file__).resolve().parents[1] / "dark-fit" / "engine"
sys.path.insert(0, str(ENGINE))

import numpy as np
from config import load_config
from fit.model import diode_model
from web_bridge import execute, execute_json, _finite_json


class DarkFitTests(unittest.TestCase):
    def setUp(self):
        self.voltage = np.linspace(-0.5, 0.3, 81)
        self.params = [1e-9, 800.0, 5e7, 2e-8]
        self.current = diode_model(self.voltage, np.array(self.params), load_config())
        self.request = {
            "dataset": {"id": "synthetic", "type": "JV", "illumination": "dark", "label": "test dark", "x": self.voltage.tolist(), "y": self.current.tolist()},
            "temperature_k": 300, "n": 1.4, "m": 2.4, "product_fit_mode": "fast_fit",
        }

    def test_manual_evaluation_preserves_signs_and_components(self):
        before = copy.deepcopy(self.request)
        payload = execute({**self.request, "action": "evaluate", "evaluator_kind": "base_j0_rs_rsh_k", "params": self.params})
        series = payload["series"]
        np.testing.assert_allclose(series["fitted"], self.current)
        np.testing.assert_allclose(np.array(series["diode"]) + series["ohmic"] + series["nonohmic"], series["fitted"])
        np.testing.assert_array_equal(series["measured"], self.current)
        self.assertLess(series["measured"][0], 0)
        self.assertEqual(self.request, before)
        self.assertTrue(payload["manual_capability"]["can_evaluate"])

    def test_fit_and_json_contract(self):
        payload = json.loads(execute_json(json.dumps(self.request)))
        self.assertEqual(payload["product_fit_mode"], "fast_fit")
        self.assertLess(payload["fit"]["stats"]["mean"], 5)
        self.assertEqual(len(payload["series"]["fitted"]), 81)
        self.assertEqual(payload["dataset"]["current_unit"], "A/cm²")
        self.assertEqual(payload["dataset"]["polarity_transform"], "identity")
        for key in ["diagnostics", "model_context", "parameter_schema", "manual_capability", "evaluator_kind", "candidates"]:
            self.assertIn(key, payload)

    def test_window_retains_actual_voltage_points(self):
        payload = execute({**self.request, "action": "evaluate", "evaluator_kind": "base_j0_rs_rsh_k", "params": self.params, "voltage_min": -0.2, "voltage_max": 0.2})
        selected = (self.voltage >= -0.2) & (self.voltage <= 0.2)
        np.testing.assert_array_equal(payload["series"]["voltage"], self.voltage[selected])
        np.testing.assert_array_equal(payload["series"]["measured"], self.current[selected])

    def test_bad_inputs_and_light_are_rejected(self):
        cases = [
            {"dataset": {**self.request["dataset"], "illumination": "light"}},
            {"dataset": {**self.request["dataset"], "illumination": "unknown"}},
            {"dataset": {**self.request["dataset"], "type": "EQE"}},
            {"dataset": {**self.request["dataset"], "y": [0] * 81}},
            {"dataset": {**self.request["dataset"], "y": [float("nan")] * 81}},
            {"dataset": {**self.request["dataset"], "y": [1, 2]}},
            {"voltage_min": -0.01, "voltage_max": 0.01},
            {"voltage_min": 1, "voltage_max": -1},
            {"temperature_k": 0}, {"n": 0}, {"m": 0},
            {"action": "evaluate", "evaluator_kind": "post_fit_model", "params": self.params},
            {"action": "evaluate", "evaluator_kind": "base_j0_rs_rsh_k", "params": [0, 1, 1, 1]},
        ]
        for override in cases:
            with self.subTest(override=override), self.assertRaises(ValueError):
                execute({**self.request, **override})

    def test_unknown_requires_explicit_confirmation(self):
        payload = execute({**self.request, "dataset": {**self.request["dataset"], "illumination": "unknown"}, "allow_unknown": True, "action": "evaluate", "evaluator_kind": "base_j0_rs_rsh_k", "params": self.params})
        self.assertEqual(payload["dataset"]["points"], 81)

    def test_nonfinite_diagnostics_are_valid_json(self):
        result = _finite_json({"covariance": np.array([float("nan"), float("inf"), 1.0])})
        self.assertEqual(json.dumps(result, allow_nan=False), '{"covariance": [null, null, 1.0]}')


if __name__ == "__main__":
    unittest.main()
