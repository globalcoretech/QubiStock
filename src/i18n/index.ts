import { hi } from "./hi";
import { en } from "./en";
import { Language, Translations } from "./types";

export * from "./types";

export const translations: Record<Language, Translations> = {
  hi,
  en,
};

export const DEFAULT_LANGUAGE: Language = "hi";

export function getInitialLanguage(): Language {
  try {
    const saved = localStorage.getItem("krishi_kendra_lang");
    if (saved === "en" || saved === "hi") {
      return saved;
    }
  } catch (e) {
    console.error("error reading language setting:", e);
  }
  return DEFAULT_LANGUAGE;
}

export function saveLanguagePreference(lang: Language) {
  try {
    localStorage.setItem("krishi_kendra_lang", lang);
  } catch (e) {
    console.error("error saving language setting:", e);
  }
}
