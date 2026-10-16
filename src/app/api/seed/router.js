import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import connectDb from "@/app/lib/db";
import Movie from "@/app/models/movie/Movie";
import { seedMovies } from "@/app/lib/movie-seed.mjs";

function authorized(request) {
  const expected = process.env.MOVIE_SEED_TOKEN;
  if (!expected) return false;
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const expectedBytes = Buffer.from(expected);
  const suppliedBytes = Buffer.from(supplied);
  return suppliedBytes.length === expectedBytes.length && timingSafeEqual(suppliedBytes, expectedBytes);
}

export async function POST(request) {
  if (!process.env.MOVIE_SEED_TOKEN) {
    return NextResponse.json({ error: "Movie seeding is not configured." }, { status: 503 });
  }
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  try {
    await connectDb();
    await Movie.init();
    const result = await seedMovies(Movie);
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    console.error("Movie seed failed:", error instanceof Error ? error.message : "Unknown error");
    return NextResponse.json({ error: "Movie catalog seeding failed; database writes or cleanup may be incomplete. Check the catalog before retrying." }, { status: 502 });
  }
}
