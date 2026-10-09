# LAUTECH Life

LAUTECH Life is a multiplayer campus everyday-life game prototype built with Phaser and a small Node WebSocket server. The first playable area is centered on Sifax Hall in LAUTECH, Ogbomoso, with the nearby SCSN Lecture Shed marked on the map.

## Run locally

Install dependencies from the repository root:

```sh
pnpm install
```

Start the game client and multiplayer server in separate terminals:

```sh
pnpm dev:server
pnpm dev:game
```

Open the Vite URL in two browser tabs. Both tabs join the same local session; use WASD or the arrow keys to move and see the other player move in real time. Walk up to Sifax Hall and press E to attend a lecture. Each player can attend once per session.

The game server owns player positions and lecture attendance. The browser sends movement input and interaction requests; the server validates proximity and broadcasts the shared player state. Cash and hunger are placeholders for upcoming campus activities such as food, transport, and student jobs.
