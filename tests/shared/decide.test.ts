import { describe, it, expect } from "../../service/node_modules/vitest";
import { decide } from "../../shared/decide";
import type { Observation } from "../../contracts";
const o: Observation = { concern: "moisture", rawScore: 50, source: "mock" };
const goal = { concern: "moisture" as const, reportedSevereSymptom: false };
describe("deterministic cosmetic decisions", () => {
  it("matches card", () =>
    expect(decide([o], goal, [])).toMatchObject({
      action: "consider_category",
      productCardId: "gel-moisturizer",
    }));
  it("prefers owned", () =>
    expect(decide([o], goal, ["moisture"]).action).toBe("use_existing_first"));
  it("requires goal evidence", () =>
    expect(decide([o], { ...goal, concern: "redness" }, []).action).toBe(
      "insufficient_evidence_retake",
    ));
  it("retakes empty", () =>
    expect(decide([], goal, []).action).toBe("insufficient_evidence_retake"));
  it("escalates self-reported symptoms regardless", () =>
    expect(
      decide([], { ...goal, reportedSevereSymptom: true }, ["moisture"]).action,
    ).toBe("see_dermatologist"));
  it("never fabricates evidence", () => {
    for (const r of decide([o], goal, []).reasons)
      for (const e of r.evidence) expect(e).toBe(o);
  });
  it("rejects invalid scores", () =>
    expect(decide([{ ...o, rawScore: NaN }], goal, []).action).toBe(
      "insufficient_evidence_retake",
    ));
  it("does not infer severity from score direction", () =>
    expect(decide([{ ...o, rawScore: 1 }], goal, []).action).toBe(
      decide([{ ...o, rawScore: 100 }], goal, []).action,
    ));
});
