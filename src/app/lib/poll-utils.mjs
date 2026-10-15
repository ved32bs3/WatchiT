export const POLL_TITLE_MAX = 120;
export const POLL_OPTION_MAX = 80;
export const POLL_OPTION_COUNT_MAX = 6;

export function normalizePollInput(title, options) {
  if (typeof title !== "string") return null;
  const normalizedTitle = title.trim();
  if (!normalizedTitle || normalizedTitle.length > POLL_TITLE_MAX || !Array.isArray(options)) return null;

  const normalizedOptions = options
    .filter((option) => typeof option === "string")
    .map((option) => option.trim());
  if (normalizedOptions.length < 2 || normalizedOptions.length > POLL_OPTION_COUNT_MAX) return null;
  if (normalizedOptions.some((option) => !option || option.length > POLL_OPTION_MAX)) return null;
  const uniqueOptions = new Set(normalizedOptions.map((option) => option.toLocaleLowerCase()));
  if (uniqueOptions.size !== normalizedOptions.length) return null;
  return { title: normalizedTitle, options: normalizedOptions };
}
