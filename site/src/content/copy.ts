import { en } from "./copy.en";
import { pt } from "./copy.pt";

export type Lang = "en" | "pt";
export type Copy = typeof en;

export function getCopy(lang: Lang): Copy {
  return lang === "pt" ? (pt as unknown as Copy) : en;
}
export const homePath = (lang: Lang): string => (lang === "pt" ? "/pt/" : "/");
export const otherLang = (lang: Lang): Lang => (lang === "pt" ? "en" : "pt");
export const privacyPath = (lang: Lang): string => (lang === "pt" ? "/pt/privacidade/" : "/privacy/");
