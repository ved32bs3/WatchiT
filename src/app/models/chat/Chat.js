import mongoose from "mongoose";

const chatMessageSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, minlength: 1, maxlength: 40 },
    msg: { type: String, required: true, trim: true, minlength: 1, maxlength: 1000 },
    timestamp: { type: Date, required: true, default: Date.now },
  },
  { _id: true },
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
  },
  { timestamps: true, collection: "chats" },
);

export default mongoose.models.Chat || mongoose.model("Chat", chatSchema);
