/**
 * decide() implementation. OWNED BY S1 (service session). Stub until S1 lands it.
 * S2 (web) imports this; do not edit from S2.
 */
import type { DecideFn } from "../contracts";

export const decide: DecideFn = (observations, goal) => ({
  action: "insufficient_evidence_retake",
  reasons: [
    {
      code: "missing_observation",
      text: `Stub: no rule engine yet for ${goal.concern}.`,
      evidence: [...observations],
    },
  ],
  nextStep: "Retake the photo in even light.",
});
