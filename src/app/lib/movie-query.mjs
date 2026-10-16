export function buildMovieSearchFilter(query = "") {
  const filter = {
    sourceProvider: "Internet Archive",
    rightsBasis: "internet-archive-license",
    availabilityStatus: "reachable",
    runtimeSeconds: { $gte: 2400 },
  };
  const normalizedQuery = typeof query === "string" ? query.trim().slice(0, 100) : "";
  if (normalizedQuery) {
    const literal = normalizedQuery.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(literal, "i");
    filter.$or = [{ title: pattern }, { description: pattern }, { categories: pattern }, { genres: pattern }];
  }
  return filter;
}
