import mongoose from "mongoose";

const movieSchema = new mongoose.Schema({
  sourceIdentifier: { type: String, required: true, trim: true },
  title: { type: String, required: true, trim: true, maxlength: 240 },
  description: { type: String, trim: true, maxlength: 4000, default: "" },
  creator: { type: String, trim: true, maxlength: 300, default: "" },
  releaseYear: { type: Number, min: 1880, max: 2100, default: null },
  runtimeSeconds: { type: Number, min: 2400, default: null },
  categories: { type: [String], default: [] },
  genres: { type: [String], default: [] },
  thumbnail: { type: String, trim: true, maxlength: 2048, default: "" },
  sourceProvider: { type: String, required: true, enum: ["Internet Archive"] },
  sourcePageUrl: { type: String, required: true, trim: true, maxlength: 2048 },
  playbackUrl: { type: String, required: true, trim: true, maxlength: 2048 },
  playerType: { type: String, required: true, enum: ["html5-video"] },
  licenseInfo: { type: String, required: true, trim: true, maxlength: 1000 },
  licenseUrl: { type: String, trim: true, maxlength: 2048, default: "" },
  rightsBasis: { type: String, required: true, enum: ["internet-archive-license"] },
  availabilityStatus: { type: String, required: true, enum: ["reachable", "metadata-listed", "unavailable"] },
  availabilityCheckedAt: { type: Date, default: null },
  lastSeededAt: { type: Date, required: true, default: Date.now },
}, { timestamps: true, collection: "movies" });

movieSchema.index({ sourceIdentifier: 1 }, { unique: true });
movieSchema.index({ title: "text", description: "text", categories: "text", genres: "text" });
movieSchema.index({ categories: 1, releaseYear: -1 });

if (mongoose.models.Movie && !mongoose.models.Movie.schema.path("sourceIdentifier")) delete mongoose.models.Movie;
export default mongoose.models.Movie || mongoose.model("Movie", movieSchema);
