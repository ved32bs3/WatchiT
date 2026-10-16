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
    video_details: {
      type: [{
        url: { type: String, required: true, trim: true },
      video_id: { type: String, required: true, trim: true },
      title: { type: String, required: true, trim: true, maxlength: 200 },
      thumbnail: { type: String, trim: true, maxlength: 2048 },
      channel_name: { type: String, trim: true, maxlength: 120 },
      provider: { type: String, trim: true, maxlength: 40, default: "youtube" },
      player_type: { type: String, trim: true, maxlength: 40, default: "youtube-iframe" },
      release_year: { type: Number, min: 1880, max: 2100, default: null },
      categories: { type: [{ type: String, trim: true, maxlength: 80 }], default: [] },
      source_page_url: { type: String, trim: true, maxlength: 2048, default: "" },
      license_info: { type: String, trim: true, maxlength: 1000, default: "" },
      availability_status: { type: String, trim: true, maxlength: 40, default: "unknown" },
      }],
      default: [],
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
  !mongoose.models.Party.schema.path("video_details") ||
  !mongoose.models.Party.schema.path("video_details.player_type") ||
  !mongoose.models.Party.schema.path("host_session_id") ||
  !mongoose.models.Party.schema.path("viewer_sessions")
)) {
  delete mongoose.models.Party;
}

export default mongoose.models.Party || mongoose.model("Party", partySchema);
