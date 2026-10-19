import i18n from "i18next";
import { initReactI18next, useTranslation } from "react-i18next";
import { zhCN } from "./locales/zh-CN";
import { errorsZhCN } from "./locales/errors-zh-CN";
import { selectionZhCN } from "./locales/selection-zh-CN";

export type Locale = "en" | "zh-CN";
export const LANGUAGE_STORAGE_KEY = "draftline-language";

export function resolveLocale(saved: string | null): Locale {
  if (saved === "en" || saved === "zh-CN") return saved;
  return "zh-CN";
}

function initialLocale(): Locale {
  let saved = null;
  try {
    saved = localStorage.getItem(LANGUAGE_STORAGE_KEY);
  } catch {
    /* Language selection also works without browser storage. */
  }
  return resolveLocale(saved);
}

void i18n.use(initReactI18next).init({
  lng: initialLocale(),
  fallbackLng: "en",
  supportedLngs: ["en", "zh-CN"],
  keySeparator: false,
  nsSeparator: false,
  interpolation: { escapeValue: false },
  resources: {
    en: { translation: {} },
    "zh-CN": { translation: { ...zhCN, ...errorsZhCN, ...selectionZhCN } },
  },
});

function updateDocumentLanguage() {
  if (typeof document === "undefined") return;
  document.documentElement.lang = currentLocale();
  document.title =
    currentLocale() === "zh-CN"
      ? "Draftline — AI 绘图工作室"
      : "Draftline — AI Drawing Studio";
}
i18n.on("languageChanged", updateDocumentLanguage);
updateDocumentLanguage();

// Stable identity keeps language changes out of request and persistence effects.
export function t(
  key: string,
  values?: Record<string, string | number>,
): string {
  return i18n.t(key, { defaultValue: key, ...values });
}

export function currentLocale(): Locale {
  return i18n.resolvedLanguage === "zh-CN" || i18n.language === "zh-CN"
    ? "zh-CN"
    : "en";
}

export function setLocale(locale: Locale) {
  void i18n.changeLanguage(locale);
  try {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, locale);
  } catch {
    /* Keep the selected language for this session. */
  }
}

export function useLocale() {
  useTranslation();
  return { locale: currentLocale(), setLocale, t };
}
