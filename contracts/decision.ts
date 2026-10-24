/** FROZEN CONTRACT (Kai, 2026-10-24). Do not edit; changes go through Kai. */
import type { Concern, Observation } from "./analysis";

/** Cosmetic-purpose tags on generic product cards (no brands, no real packaging). */
export type PurposeTag = Concern;

export interface ProductCard {
  id: string;
  /** Generic own-label name, e.g. "Gel Moisturizer". */
  name: string;
  category: string;
  purposeTags: PurposeTag[];
  description: string;
}

export interface Goal {
  /** The concern the shopper selected before checkout. */
  concern: Concern;
  /** User self-reported severe/painful symptoms -> escalate, never diagnose. */
  reportedSevereSymptom: boolean;
}

export type DecisionAction =
  | "use_existing_first"
  | "consider_category"
  | "insufficient_evidence_retake"
  | "see_dermatologist";

export interface DecisionReason {
  code:
    | "owned_tag_covers_goal"
    | "goal_observed"
    | "goal_not_observed"
    | "missing_observation"
    | "non_live_source"
    | "symptom_escalation";
  /** English, cosmetic-only wording. */
  text: string;
  /** Observations this reason relies on (verbatim, never fabricated). */
  evidence: Observation[];
}

export interface Decision {
  action: DecisionAction;
  /** Card suggested when action is consider_category. */
  productCardId?: string;
  reasons: DecisionReason[];
  /** One next action, shown as the primary CTA text. */
  nextStep: string;
}

/** Pure and deterministic; runs in browser (ownership toggle without another API call) and in tests. */
export type DecideFn = (
  observations: readonly Observation[],
  goal: Goal,
  ownedTags: readonly PurposeTag[],
) => Decision;
