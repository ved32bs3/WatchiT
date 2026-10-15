import mongoose from "mongoose";

const cache = globalThis.mongooseCache ?? {
  connection: null,
  promise: null,
};

globalThis.mongooseCache = cache;

export default async function connectDb() {
  if (cache.connection) return cache.connection;

  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) {
    throw new Error("MONGODB_URI is not configured.");
  }

  if (!cache.promise) {
    cache.promise = mongoose
      .connect(uri, {
        bufferCommands: false,
        ...(process.env.MONGODB_DB_NAME ? { dbName: process.env.MONGODB_DB_NAME } : {}),
      })
      .then((connection) => {
        console.log("DB connected!");
        return connection;
      })
      .catch((error) => {
        console.error("MongoDB connection failed.", { name: error.name, code: error.code });
        cache.promise = null;
        throw error;
      });
  }

  try {
    cache.connection = await cache.promise;
    return cache.connection;
  } catch (error) {
    cache.promise = null;
    throw new Error("MongoDB connection failed.", { cause: error });
  }
}
