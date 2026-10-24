import { CONCERNS, type Observation } from "../../contracts";
export const SAMPLE: Observation[] = CONCERNS.map((concern, i) => ({
  concern,
  rawScore: [62, 48, 35, 71][i]!,
  source: "sample",
}));
