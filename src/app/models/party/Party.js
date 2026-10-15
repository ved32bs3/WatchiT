import mongoose from "mongoose";

const partySchema = new mongoose.Schema(
  {
    host_name: {
      type: String,
      required: true,
      trim: true,
      minlength: 1,
      maxlength: 40,
    },
    host_session_id: { type: String, trim: true, default: null },
    viewer_sessions: {
      type: [{
        participant_id: { type: String, required: true, trim: true },
        name: { type: String, required: true, trim: true, maxlength: 40 },
      }],
      default: [],
    },
    viewers: {
      type: [{ type: String, trim: true, maxlength: 40 }],
      default: [],
    },
    party_code: {
      type: Number,
      required: true,
      min: 100000,
      max: 999999,
      unique: true,
      index: true,
    },
    video_urls: {
      type: [{ type: String, trim: true }],
      required: true,
      validate: {
        validator: (urls) => Array.isArray(urls) && urls.length > 0,
        message: "A party must have at least one video URL.",
      },
    },
    playlist_version: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true, collection: "parties" },
);

// Next.js hot reload preserves mongoose.models between edits. Drop a cached
// development model that still contains the old persistent live-playback fields.
if (mongoose.models.Party && (
  mongoose.models.Party.schema.path("active_video_url") ||
  mongoose.models.Party.schema.path("playback") ||
  !mongoose.models.Party.schema.path("playlist_version") ||
  !mongoose.models.Party.schema.path("host_session_id") ||
  !mongoose.models.Party.schema.path("viewer_sessions")
)) {
  delete mongoose.models.Party;
}

export default mongoose.models.Party || mongoose.model("Party", partySchema);
