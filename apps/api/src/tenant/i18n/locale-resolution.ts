import type { LocaleCode, SessionLocalePreferenceInput } from "@pms-saas/shared-types";
import { PRODUCT_CONFIG } from "@pms-saas/config";

function isEnabledLocale(value: string | null | undefined, enabledLocales: LocaleCode[]): value is LocaleCode {
  if (!value) return false;
  return enabledLocales.includes(value as LocaleCode);
}

export function resolveActiveSessionLocale(input: SessionLocalePreferenceInput): LocaleCode {
  if (isEnabledLocale(input.requestedLocale, input.enabledLocales)) {
    return input.requestedLocale;
  }

  if (isEnabledLocale(input.preferredLocale, input.enabledLocales)) {
    return input.preferredLocale;
  }

  if (isEnabledLocale(input.defaultLocale, input.enabledLocales)) {
    return input.defaultLocale;
  }

  return PRODUCT_CONFIG.defaultLocale;
}

export function resolveAiAnswerLocale(
  questionLocale: string | null | undefined,
  enabledLocales: LocaleCode[],
  defaultLocale: LocaleCode,
): LocaleCode {
  if (isEnabledLocale(questionLocale, enabledLocales)) {
    return questionLocale;
  }

  if (isEnabledLocale(defaultLocale, enabledLocales)) {
    return defaultLocale;
  }

  return PRODUCT_CONFIG.defaultLocale;
}
