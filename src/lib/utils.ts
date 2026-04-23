export function normalizeSearchText(input: string) {
  return input
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function createSlug(input: string) {
  return normalizeSearchText(input).replace(/\s+/g, "-");
}

export function createUiAvatarUrl(name: string) {
  const encoded = encodeURIComponent(name);
  return `https://ui-avatars.com/api/?name=${encoded}&background=0e1729&color=ffffff&size=256&bold=true&rounded=true`;
}

export function formatYearRange(startYear: number, endYear: number | null) {
  return `${startYear} - ${endYear ?? "Current"}`;
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}
