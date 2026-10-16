import test from "node:test";
import assert from "node:assert/strict";
import { normalizeMovieGenres } from "../src/app/lib/movie-genres.mjs";

test("normalizes movie subjects to concise recognized genres", () => {
  assert.deepEqual(normalizeMovieGenres([
    "Drama",
    "German experimental Cinema",
    "2008",
    "Source creator",
    "Drama",
    "Feature Films",
    "Science Fiction",
    "Comedia",
  ]), ["Comedy", "Drama", "Experimental", "Fantasy & Science Fiction"]);
});

test("recognizes common alternate genre labels and ignores unrelated subjects", () => {
  assert.deepEqual(normalizeMovieGenres([
    "documentales",
    "ciencia ficción",
    "sci-fi",
    "film noir",
    "zombie film",
    "romantic comedy",
    "Animals",
    "Motion pictures",
  ]), [
    "Comedy",
    "Crime & Mystery",
    "Documentary",
    "Fantasy & Science Fiction",
    "Horror & Thriller",
    "Romance",
  ]);
});

test("limits the taxonomy to ten labels and ignores malformed subjects", () => {
  assert.equal(normalizeMovieGenres(null).length, 0);
  assert.equal(normalizeMovieGenres([null, 2008, {}, "Feature Films", "Uploader name"]).length, 0);
  assert.equal(normalizeMovieGenres([
    "Action", "Animation", "Comedy", "Crime", "Documentary",
    "Drama", "Experimental", "Fantasy", "Horror", "Romance", "Western",
  ]).length, 10);
});
