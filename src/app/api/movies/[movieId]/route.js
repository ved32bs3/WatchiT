import { NextResponse } from "next/server";
import connectDb from "@/app/lib/db";
import Movie from "@/app/models/movie/Movie";
import { buildMovieSearchFilter } from "@/app/lib/movie-query.mjs";

export async function GET(_request, { params }) {
  const { movieId } = await params;
  if (!/^[A-Za-z0-9._-]{1,120}$/.test(movieId)) return NextResponse.json({ error: "Invalid movie ID." }, { status: 400 });
  try {
    await connectDb();
    const movie = await Movie.findOne({ sourceIdentifier: movieId, ...buildMovieSearchFilter() }).lean();
    if (!movie) return NextResponse.json({ error: "Movie not found." }, { status: 404 });
    return NextResponse.json({ movie });
  } catch (error) {
    console.error("Movie detail lookup failed:", error instanceof Error ? error.message : "Unknown error");
    return NextResponse.json({ error: "Movie details are temporarily unavailable." }, { status: 503 });
  }
}
