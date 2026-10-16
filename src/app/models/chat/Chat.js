import mongoose from "mongoose";

const chatMessageSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, minlength: 1, maxlength: 40 },
    msg: { type: String, required: true, trim: true, minlength: 1, maxlength: 1000 },
    timestamp: { type: Date, required: true, default: Date.now },
  },
  { _id: true },
);

const pollSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    description: { type: String, required: true, trim: true, maxlength: 120 },
    pollParams: {
      type: [{
        option_id: { type: String, required: true },
        value: { type: String, required: true, trim: true, maxlength: 80 },
        votes: { type: Number, required: true, min: 0, default: 0 },
      }],
      default: [],
    },
    voters: {
      type: [{
        participant_id: { type: String, required: true },
        option_id: { type: String, required: true },
      }],
      default: [],
    },
    isOpen: { type: Boolean, required: true, default: true },
    createdAt: { type: Date, required: true, default: Date.now },
    closedAt: { type: Date, default: null },
    revision: { type: Number, min: 0, default: 0 },
  },
  { _id: false },
);

const chatSchema = new mongoose.Schema(
  {
    party_code: {
      type: Number,
      required: true,
      min: 100000,
      max: 999999,
      unique: true,
      index: true,
    },
    messages: { type: [chatMessageSchema], default: [] },
    poll: { type: pollSchema, default: null },
  },
  { timestamps: true, collection: "chats" },
);

if (mongoose.models.Chat && !mongoose.models.Chat.schema.path("poll")) {
  delete mongoose.models.Chat;
}

export default mongoose.models.Chat || mongoose.model("Chat", chatSchema);
