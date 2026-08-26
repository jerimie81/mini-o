export function migratePreferences(storage) {
  const currentModel = storage.getItem("mini-o.model");
  if (!currentModel || currentModel.startsWith("gemini") || currentModel !== "minimax-m3:cloud") {
    storage.setItem("mini-o.model", "minimax-m3:cloud");
  }
  if (storage.getItem("mini-o.preferences-version") === "2") return false;
  const legacy = [["mini-o.selected-model", "mini-o.model"], ["mini-o.dark-mode", "mini-o.theme"]];
  legacy.forEach(([oldKey, newKey]) => {
    const value = storage.getItem(oldKey);
    if (value !== null && storage.getItem(newKey) === null) storage.setItem(newKey, newKey.endsWith("theme") ? (value === "true" ? "dark" : "light") : value);
  });
  storage.setItem("mini-o.preferences-version", "2"); return true;
}
