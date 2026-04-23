import type { Server as SocketIOServer } from "socket.io";

declare global {
  // eslint-disable-next-line no-var
  var __guessThePlayerIo: SocketIOServer | undefined;
}

export function setSocketServer(io: SocketIOServer) {
  globalThis.__guessThePlayerIo = io;
}

export function getSocketServer() {
  return globalThis.__guessThePlayerIo;
}
