import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { LOCATION, MESSAGE, WORLD } from "../../../packages/shared/src/protocol.js";
import { WebSocket, WebSocketServer } from "ws";

const port = Number(process.env.PORT ?? 2567);
const clients = new Map();
const server = createServer((request, response) => {
  if (request.url === "/health") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ status: "ok", players: clients.size }));
    return;
  }

  response.writeHead(404);
  response.end("Not found");
});

const webSockets = new WebSocketServer({ noServer: true, maxPayload: 512 });

server.on("upgrade", (request, socket, head) => {
  const url = new URL(request.url ?? "/", "http://localhost");
  if (url.pathname !== "/ws") {
    socket.destroy();
    return;
  }

  webSockets.handleUpgrade(request, socket, head, (webSocket) => {
    webSockets.emit("connection", webSocket, request);
  });
});

function getPlayers() {
  return [...clients.values()].map(({ id, x, y, money, hunger, classesAttended, location }) => ({
    id,
    x,
    y,
    money,
    hunger,
    classesAttended,
    location,
  }));
}

function broadcastState() {
  const message = JSON.stringify({ type: MESSAGE.state, players: getPlayers() });
  for (const webSocket of clients.keys()) {
    if (webSocket.readyState === WebSocket.OPEN) webSocket.send(message);
  }
}

function sendNotice(webSocket, text, tone) {
  if (webSocket.readyState !== WebSocket.OPEN) return;
  webSocket.send(JSON.stringify({ type: MESSAGE.notice, text, tone }));
}

function notifyLocationChange(webSocket, player, messageForPlayer, messageForOthers) {
  broadcastState();
  for (const client of clients.keys()) {
    sendNotice(
      client,
      client === webSocket ? messageForPlayer : messageForOthers,
      "success",
    );
  }
}

function interactAtSifax(webSocket, player) {
  if (player.location === LOCATION.campus) {
    const distanceToDoor = Math.hypot(
      player.x - WORLD.sifaxDoorX,
      player.y - WORLD.sifaxDoorY,
    );
    if (distanceToDoor > WORLD.sifaxRadius) {
      sendNotice(webSocket, "Walk to the Sifax entrance first.", "error");
      return;
    }

    player.location = LOCATION.sifax;
    player.x = WORLD.interiorSpawnX;
    player.y = WORLD.interiorSpawnY;
    notifyLocationChange(
      webSocket,
      player,
      "You entered Sifax Hall. Find a seat or walk to the lectern.",
      `Player ${player.id} entered Sifax Hall.`,
    );
    return;
  }

  const distanceToExit = Math.hypot(
    player.x - WORLD.interiorExitX,
    player.y - WORLD.interiorExitY,
  );
  if (distanceToExit <= WORLD.interactionRadius) {
    player.location = LOCATION.campus;
    player.x = WORLD.sifaxDoorX;
    player.y = WORLD.sifaxDoorY + WORLD.sifaxRadius;
    notifyLocationChange(
      webSocket,
      player,
      "You stepped outside Sifax Hall.",
      `Player ${player.id} stepped outside Sifax Hall.`,
    );
    return;
  }

  const distanceToLectern = Math.hypot(
    player.x - WORLD.lecternX,
    player.y - WORLD.lecternY,
  );
  if (distanceToLectern > WORLD.interactionRadius) {
    sendNotice(webSocket, "Move to the lectern for class or the door to leave.", "error");
    return;
  }
  if (player.classesAttended > 0) {
    sendNotice(webSocket, "You have already attended the Sifax lecture this session.", "error");
    return;
  }

  player.classesAttended += 1;
  broadcastState();
  for (const client of clients.keys()) {
    sendNotice(
      client,
      client === webSocket
        ? "You attended a lecture at Sifax Hall."
        : `Player ${player.id} attended a lecture at Sifax Hall.`,
      "success",
    );
  }
}

webSockets.on("connection", (webSocket) => {
  const playerIndex = clients.size;
  const spawnOffsetX = ((playerIndex % 5) - 2) * 22;
  const spawnOffsetY = (Math.floor(playerIndex / 5) - 2) * 22;
  const player = {
    id: randomUUID().slice(0, 8),
    x: WORLD.spawnX + spawnOffsetX,
    y: WORLD.spawnY + spawnOffsetY,
    inputX: 0,
    inputY: 0,
    money: WORLD.startingMoney,
    hunger: WORLD.startingHunger,
    classesAttended: 0,
    location: LOCATION.campus,
  };

  clients.set(webSocket, player);
  webSocket.send(
    JSON.stringify({ type: MESSAGE.welcome, selfId: player.id, players: getPlayers() }),
  );
  broadcastState();

  webSocket.on("message", (raw) => {
    let message;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (message?.type === MESSAGE.interact) {
      interactAtSifax(webSocket, player);
      return;
    }

    if (message?.type === MESSAGE.input) {
      if (!Number.isFinite(message.x) || !Number.isFinite(message.y)) return;

      const x = Math.max(-1, Math.min(1, message.x));
      const y = Math.max(-1, Math.min(1, message.y));
      const length = Math.hypot(x, y);
      player.inputX = length > 1 ? x / length : x;
      player.inputY = length > 1 ? y / length : y;
    }
  });

  webSocket.on("close", () => {
    clients.delete(webSocket);
    broadcastState();
  });

  webSocket.on("error", (error) => {
    console.error("Player socket error:", error.message);
  });
});

let previousTick = Date.now();
setInterval(() => {
  const now = Date.now();
  const delta = Math.min((now - previousTick) / 1000, 0.1);
  previousTick = now;

  for (const player of clients.values()) {
    const minX = player.location === LOCATION.sifax ? WORLD.roomMinX : WORLD.minX;
    const maxX = player.location === LOCATION.sifax ? WORLD.roomMaxX : WORLD.maxX;
    const minY = player.location === LOCATION.sifax ? WORLD.roomMinY : WORLD.minY;
    const maxY = player.location === LOCATION.sifax ? WORLD.roomMaxY : WORLD.maxY;
    player.x = Math.max(minX, Math.min(maxX, player.x + player.inputX * WORLD.playerSpeed * delta));
    player.y = Math.max(minY, Math.min(maxY, player.y + player.inputY * WORLD.playerSpeed * delta));
  }

  broadcastState();
}, 50);

server.listen(port, "127.0.0.1", () => {
  console.log(`LAUTECH Life server listening on http://localhost:${port}`);
});
