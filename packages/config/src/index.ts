export const PRODUCT_CONFIG = {
  supportedLocales: ["es", "en", "pt"] as const,
  defaultInsightPanelSize: 5,
  temporaryAiFileTtlHours: 24,
  certificateExpiringSoonDays: 30,
  tenantLoginMode: "email_or_legacy_user_id" as const,
  defaultTimezone: "UTC",
  defaultCurrency: "USD",
  defaultLocale: "es" as const,
  adminSubdomain: "admin",
} as const;
