import { createServer } from "node:http";
import next from "next";
import { Server as SocketIOServer } from "socket.io";
import { attachWatchPartySockets } from "./src/server/socket.mjs";

const dev = process.env.NODE_ENV !== "production";
const portFlagIndex = process.argv.indexOf("--port");
const portFromArgs = portFlagIndex >= 0 ? process.argv[portFlagIndex + 1] : undefined;
const port = Number(process.env.PORT || portFromArgs || (dev ? 3001 : 3000));
const hostname = process.env.WATCHIT_HOST || "0.0.0.0";

const app = next({ dev, hostname, port });
await app.prepare();

const handle = app.getRequestHandler();
const httpServer = createServer((request, response) => {
  handle(request, response).catch((error) => {
    console.error("Next.js request failed:", error);
    if (!response.headersSent) response.statusCode = 500;
    response.end("Internal Server Error");
  });
});

const io = new SocketIOServer(httpServer, {
  maxHttpBufferSize: 32 * 1024,
  pingInterval: 25_000,
  pingTimeout: 20_000,
});
attachWatchPartySockets(io);

httpServer.listen(port, hostname, () => {
  console.log(`Watchit server listening at http://localhost:${port}`);
});
