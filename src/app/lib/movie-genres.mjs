const GENRE_RULES = [
  ["Action & Adventure", /\b(?:action|acci[oó]n|adventure|aventura|western|cowboy)\b/i],
  ["Animation", /\b(?:animation|animaci[oó]n|animated|anime|cartoon|dibujos animados)\b/i],
  ["Comedy", /\b(?:comedy|comedies|comedia|kom[oö]die|humou?r|satire|parody)\b/i],
  ["Crime & Mystery", /\b(?:crime|crimen|mystery|mysteries|misterio|misterios|detective|noir)\b/i],
  ["Documentary", /\b(?:documentary|documentaries|documental|documentales|non.?fiction)\b/i],
  ["Drama", /\b(?:drama|dramatic|melodrama|tragedy)\b/i],
  ["Experimental", /\bexperimental\b/i],
  ["Fantasy & Science Fiction", /\b(?:fantasy|fantas[ií]a|science fiction|ciencia ficci[oó]n|sci[\s-]?fi|scifi|space opera|star wars)\b/i],
  ["Horror & Thriller", /\b(?:horror|thriller|suspense|terror|zombie|vampire|slasher)\b/i],
  ["Romance", /\b(?:romance|romantic|rom[aá]ntic[oa]|love story)\b/i],
];

export function normalizeMovieGenres(subjects) {
  if (!Array.isArray(subjects)) return [];
  const text = subjects.filter((subject) => typeof subject === "string").join(" ");
  return GENRE_RULES
    .filter(([, pattern]) => pattern.test(text))
    .map(([genre]) => genre);
}
