const catalogs = { en: { saved: "Saved", unsaved: "Unsaved changes", offline: "Ollama offline", ready: "Ready" } };
export function message(key, locale = navigator.language?.slice(0, 2) || "en") { return catalogs[locale]?.[key] || catalogs.en[key] || key; }
export function formatDate(value, options = {}) { return new Intl.DateTimeFormat(undefined, options).format(new Date(value)); }
