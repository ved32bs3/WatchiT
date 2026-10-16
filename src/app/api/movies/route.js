import { NextResponse } from "next/server";
import connectDb from "@/app/lib/db";
import Movie from "@/app/models/movie/Movie";
import { buildMovieSearchFilter } from "@/app/lib/movie-query.mjs";
import { normalizeMovieGenres } from "@/app/lib/movie-genres.mjs";

const PAGE_SIZE = 50;

export async function GET(request) {
  const params = new URL(request.url).searchParams;
  const query = (params.get("q") ?? "").trim().slice(0, 100);
  const category = (params.get("category") ?? "").trim().slice(0, 80);
  const filter = buildMovieSearchFilter(query);

  try {
    await connectDb();
    const [records, total] = await Promise.all([
      Movie.find(filter).sort({ releaseYear: -1, title: 1 }).limit(PAGE_SIZE).select({ sourceIdentifier: 1, title: 1, description: 1, creator: 1, releaseYear: 1, runtimeSeconds: 1, categories: 1, genres: 1, thumbnail: 1, sourceProvider: 1, sourcePageUrl: 1, playbackUrl: 1, playerType: 1, licenseInfo: 1, licenseUrl: 1, availabilityStatus: 1 }).lean(),
      Movie.countDocuments(filter),
    ]);
    const allMovies = records.map((movie) => {
      const subjects = movie.genres?.length ? movie.genres : movie.categories;
      return { ...movie, categories: normalizeMovieGenres(subjects) };
    });
    const movies = category
      ? allMovies.filter((movie) => movie.categories.includes(category))
      : allMovies;
    const categories = [...new Set(allMovies.flatMap((movie) => movie.categories))].sort();
    return NextResponse.json({ movies, categories, total: category ? movies.length : total });
  } catch (error) {
    console.error("Movie recommendations query failed:", error instanceof Error ? error.message : "Unknown error");
    return NextResponse.json({ error: "Movie recommendations are temporarily unavailable." }, { status: 503 });
  }
}
