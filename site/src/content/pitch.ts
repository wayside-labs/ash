import { pitchEn } from "./pitch.en";
import { pitchPt } from "./pitch.pt";
import type { Lang } from "./copy";

export type Pitch = typeof pitchEn;
export type Slide = Pitch["slides"][number];
export type LeadKind = keyof Pitch["gate"]["kinds"];

export function getPitch(lang: Lang): Pitch {
  return lang === "pt" ? (pitchPt as unknown as Pitch) : pitchEn;
}
export const pitchPath = (lang: Lang): string => (lang === "pt" ? "/pt/pitch/" : "/pitch/");
export const investorPath = (lang: Lang): string => (lang === "pt" ? "/pt/investidor/" : "/investor/");
