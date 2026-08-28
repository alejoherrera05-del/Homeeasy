"""Opt-in real-model intent routing evaluation for Hommy 2.0.

Run only in an authorized secret-bearing environment:
HOMMY_RUN_MODEL_INTENT_EVAL=1 python -m unittest tests.test_hommy_intent_model_eval -v
"""

from __future__ import annotations

import os
import unittest
from datetime import date

from openai import OpenAI

from hommy_backend.auth import AuthContext
from hommy_backend.engine import HommyEngine
from hommy_backend.periods import resolve_period
from hommy_backend.tools import tools_for_context
from tests.test_hommy_intent_eval import INTENT_CASES


@unittest.skipUnless(
    os.getenv("HOMMY_RUN_MODEL_INTENT_EVAL") == "1",
    "Real-model intent evaluation is opt-in and requires a secure API credential.",
)
class HommyRealModelIntentEval(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        api_key = os.getenv("OPENAI_API_KEY", "").strip()
        if not api_key or api_key == "test-key-not-for-network-calls":
            raise unittest.SkipTest("No secure OpenAI credential is available.")
        cls.client = OpenAI(api_key=api_key)
        cls.model = os.getenv("HOMMY_MODEL", "gpt-5.6-terra").strip()
        cls.context = AuthContext(
            "intent-eval-user",
            "Evaluación Hommy",
            "intent-eval@example.invalid",
            "QA",
            frozenset(
                {
                    "app.access",
                    "clientes.read",
                    "ventas.read",
                    "reportes.read",
                    "caja.read",
                    "agenda.read",
                    "cotizaciones.read",
                    "cotizaciones.write",
                }
            ),
        )

    def test_fixed_corpus_routes_to_expected_first_tool(self):
        failures = []
        for prompt, expected_tool, expected_period in INTENT_CASES:
            with self.subTest(prompt=prompt):
                response = self.client.responses.create(
                    model=self.model,
                    instructions=HommyEngine.instructions(self.context),
                    input=prompt,
                    tools=tools_for_context(self.context),
                    tool_choice="required",
                    parallel_tool_calls=False,
                    reasoning={"effort": "low"},
                    max_output_tokens=500,
                )
                calls = [item for item in response.output if getattr(item, "type", "") == "function_call"]
                actual = calls[0].name if calls else "NO_TOOL"
                if actual != expected_tool:
                    failures.append((prompt, expected_tool, actual))
                    continue
                if expected_period and calls:
                    import json

                    arguments = json.loads(calls[0].arguments or "{}")
                    period_text = arguments.get("periodo") or arguments.get("fecha") or prompt
                    period = resolve_period(str(period_text), now=date(2026, 8, 28))
                    if period is None or period.key != expected_period:
                        failures.append((prompt, f"{expected_tool}:{expected_period}", f"{actual}:{period_text}"))
        self.assertEqual(failures, [], f"Intent routing mismatches: {failures}")


if __name__ == "__main__":
    unittest.main(verbosity=2)
