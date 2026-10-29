/**
 * FROZEN CONTRACT (Kai, 2026-10-24). Breakout Log (provisional name). Source: /workspace/eng/arch/youcam-breakoutlog-v1.md
 * (approved by wu 10/24 16:53 Taipei). Appearance log only: never determines a cause, never labels purging vs. reaction,
 * never ranks products to stop, never computes improvement percentages.
 */
import type { Observation, ObservationSource, ZoneLabel } from "./analysis";

/** A product the user started recently (self-reported). Category is free text (e.g. "retinoid serum"); no brands needed. */
export interface ProductChange {
  id: string;
  category: string;
  startedOn: string; // YYYY-MM-DD
  active: "yes" | "no" | "unknown"; // contains an active ingredient (retinoid, acid, BPO...) per the user
  note?: string;
}

/** A dated, self-reported ingredient record. Stored and exported with the device log. */
export interface IngredientNote extends Omit<ProductChange, 'startedOn'> {
  date: string; // YYYY-MM-DD
  ingredients: string;
  startedOn?: string;
}

/** Location and discomfort come from the user, never from AI localisation claims. */
export interface SelfReport {
  areas: string;
  discomfort: string;
  reportedSevereSymptom: boolean; // true => referral branch (see a dermatologist), no other advice
}

export type Zone = "t_zone" | "u_zone" | "other";
/** Our own mask heuristics (NOT provider fields; the UI must say "estimated by this app from the YouCam mask"). */
export interface ZoneStats {
  zone: Zone;
  acneSpots: number; // connected marker blobs whose centroid falls in the zone (packed spots under-count)
  rednessPixels: number; // pixels with redness alpha > 0
  rednessMeanAlpha: number; // mean alpha (0-255) over those pixels, 0 when none
}
export interface DerivedRegions {
  method: "mask-heuristic.v1";
  imageSize: { w: 600; h: 800 };
  zones: ZoneStats[]; // exactly one per Zone, order t_zone, u_zone, other
}

/** Capture-consistency check required before any cross-day side-by-side. */
export interface FramingCheck {
  guideShown: true;
  userConfirmedSameFraming: boolean;
  imageSize: { w: number; h: number };
}

/** One analysis in the log. Contains NO image, NO mask, NO provider URL or task id. */
export interface LogEntry {
  id: string;
  date: string; // ISO-8601 capture time (client)
  source: ObservationSource;
  observations: Observation[];
  zoneLabels: ZoneLabel[];
  regions?: DerivedRegions;
  framing: FramingCheck;
}

/** The whole log; lives only on the user's device (download/import JSON). No server-side storage. */
export interface BreakoutLog {
  version: "breakout-log.v1";
  createdAt: string;
  changes: ProductChange[];
  selfReport: SelfReport;
  entries: LogEntry[];
  ingredientNotes?: IngredientNote[];
}

export type UnknownCode =
  | "cause_not_determined" // always present
  | "no_live_baseline" // no entry with source "live"
  | "cross_day_not_comparable" // >=2 entries but framing/method/size prevents comparison
  | "missing_start_date"; // a change without a valid startedOn
export interface Unknown {
  code: UnknownCode;
  text: string; // English, cosmetic-only wording
}

export type TimelineItem =
  | { kind: "change"; date: string; change: ProductChange }
  | { kind: "entry"; date: string; entry: LogEntry };

export interface LogView {
  timeline: TimelineItem[]; // sorted ascending by date (changes by startedOn, entries by date)
  baseline?: LogEntry; // earliest live entry, if any
  unknowns: Unknown[];
  referral?: string; // set iff selfReport.reportedSevereSymptom
}

/** Pure + deterministic; replaces decide(). */
export type BuildLog = (log: BreakoutLog) => LogView;
/** Validates an imported file; rejects anything with image data, data: URLs, http(s) URLs or unknown versions. */
export type ParseLogFile = (json: unknown) => { ok: true; log: BreakoutLog } | { ok: false; reason: string };
/** Side-by-side only; refuses when method/imageSize differ or either entry lacks userConfirmedSameFraming. */
export type CompareEntries = (
  a: LogEntry,
  b: LogEntry,
) =>
  | {
      rows: { concern: Observation["concern"]; a?: Observation; b?: Observation }[];
      zones?: { zone: Zone; a: ZoneStats; b: ZoneStats }[];
    }
  | { refused: string };

/** Decoded RGBA image (browser ImageData-compatible). */
export interface RgbaImage {
  width: number;
  height: number;
  data: Uint8ClampedArray | Uint8Array;
}
/** Computes DerivedRegions from decoded masks (same 600x800 pixel space). Missing masks => that stat is 0 and zone "other" absorbs. */
export type DeriveRegions = (masks: { acne?: RgbaImage; redness?: RgbaImage; tZone?: RgbaImage; uZone?: RgbaImage }) => DerivedRegions;
