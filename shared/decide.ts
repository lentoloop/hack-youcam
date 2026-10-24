import type { DecideFn, DecisionReason } from "../contracts";
import { PRODUCT_CARDS } from "./products";

export const decide: DecideFn = (observations, goal, ownedTags) => {
  if (goal.reportedSevereSymptom)
    return {
      action: "see_dermatologist",
      reasons: [
        {
          code: "symptom_escalation",
          text: "You reported severe or painful symptoms. Cosmetic analysis cannot assess these.",
          evidence: [],
        },
      ],
      nextStep: "See a dermatologist.",
    };
  // Score direction is UNCONFIRMED. Presence of valid evidence never implies severity.
  const evidence = observations.filter(
    (o) =>
      o.concern === goal.concern &&
      Number.isFinite(o.rawScore) &&
      o.rawScore >= 1 &&
      o.rawScore <= 100,
  );
  if (!evidence.length)
    return {
      action: "insufficient_evidence_retake",
      reasons: [
        {
          code: observations.length
            ? "goal_not_observed"
            : "missing_observation",
          text: "There is insufficient evidence for your selected cosmetic goal.",
          evidence: [],
        },
      ],
      nextStep: "Retake the photo in even light.",
    };
  const reasons: DecisionReason[] = [
    {
      code: "goal_observed",
      text: "An observation is available for your selected cosmetic goal; it does not establish a need to buy.",
      evidence,
    },
  ];
  if (evidence.some((o) => o.source !== "live"))
    reasons.push({
      code: "non_live_source",
      text: "These are labeled sample or synthetic mock observations, not a live assessment.",
      evidence: evidence.filter((o) => o.source !== "live"),
    });
  if (ownedTags.includes(goal.concern))
    return {
      action: "use_existing_first",
      reasons: [
        ...reasons,
        {
          code: "owned_tag_covers_goal",
          text: "A category you already own covers this cosmetic purpose.",
          evidence,
        },
      ],
      nextStep: "Use your existing product first, following its label.",
    };
  return {
    action: "consider_category",
    productCardId: PRODUCT_CARDS.find((p) =>
      p.purposeTags.includes(goal.concern),
    )!.id,
    reasons,
    nextStep: "Consider this category before choosing another product.",
  };
};
