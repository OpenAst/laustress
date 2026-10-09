import { MESSAGE } from "../../../../packages/shared/src/protocol.js";
import type { PlayerState, ServerMessage } from "../../../../packages/shared/src/protocol.js";

type Status = "connecting" | "connected" | "disconnected";

export class GameConnection {
  private socket?: WebSocket;
  private inputX = 0;
  private inputY = 0;
  private selfId = "";
  private readonly onPlayers: (players: PlayerState[], selfId: string) => void;
  private readonly onStatus: (status: Status) => void;
  private readonly onNotice: (text: string, tone: "success" | "error") => void;

  constructor(
    onPlayers: (players: PlayerState[], selfId: string) => void,
    onStatus: (status: Status) => void,
    onNotice: (text: string, tone: "success" | "error") => void,
  ) {
    this.onPlayers = onPlayers;
    this.onStatus = onStatus;
    this.onNotice = onNotice;
  }

  connect() {
    const scheme = window.location.protocol === "https:" ? "wss" : "ws";
    this.onStatus("connecting");
    this.socket = new WebSocket(`${scheme}://${window.location.host}/ws`);

    this.socket.addEventListener("open", () => {
      this.onStatus("connected");
      this.sendInput();
    });

    this.socket.addEventListener("message", (event) => {
      let message: ServerMessage;
      try {
        message = JSON.parse(String(event.data)) as ServerMessage;
      } catch {
        return;
      }

      if (message.type === MESSAGE.welcome) {
        this.selfId = message.selfId;
        this.onPlayers(message.players, message.selfId);
      } else if (message.type === MESSAGE.state) {
        this.onPlayers(message.players, this.selfId);
      } else if (message.type === MESSAGE.notice) {
        this.onNotice(message.text, message.tone);
      }
    });

    this.socket.addEventListener("close", () => this.onStatus("disconnected"));
    this.socket.addEventListener("error", () => this.onStatus("disconnected"));
  }

  setInput(x: number, y: number) {
    const length = Math.hypot(x, y);
    const normalizedX = length > 1 ? x / length : x;
    const normalizedY = length > 1 ? y / length : y;
    if (normalizedX === this.inputX && normalizedY === this.inputY) return;

    this.inputX = normalizedX;
    this.inputY = normalizedY;
    this.sendInput();
  }

  interact() {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify({ type: MESSAGE.interact }));
  }

  disconnect() {
    this.socket?.close();
  }

  private sendInput() {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify({ type: MESSAGE.input, x: this.inputX, y: this.inputY }));
  }
}
