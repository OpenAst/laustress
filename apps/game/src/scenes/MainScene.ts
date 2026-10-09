import Phaser from "phaser";
import { GameConnection } from "../network/GameConnection";
import { CAMPUS_LANDMARKS, getMapOrigin, landmarkToScreen, SIFAX_HALL } from "../map/campusMap";
import { LOCATION, WORLD } from "../../../../packages/shared/src/protocol.js";
import type { PlayerState } from "../../../../packages/shared/src/protocol.js";

const WORLD_WIDTH = WORLD.width;
const WORLD_HEIGHT = WORLD.height;
const TILE_SIZE = 256;
const MAP_ZOOM = 18;
const OSM_TILE_URL =
  import.meta.env.VITE_OSM_TILE_URL ?? "https://tile.openstreetmap.org/{z}/{x}/{y}.png";

type MapTile = { key: string; x: number; y: number };

export class MainScene extends Phaser.Scene {
  private movementKeys!: Record<string, Phaser.Input.Keyboard.Key>;
  private interactionKey!: Phaser.Input.Keyboard.Key;
  private playerActors = new Map<string, Phaser.GameObjects.Container>();
  private connection!: GameConnection;
  private connectionText!: Phaser.GameObjects.Text;
  private statsText!: Phaser.GameObjects.Text;
  private sifaxPrompt!: Phaser.GameObjects.Text;
  private toastText!: Phaser.GameObjects.Text;
  private toastTime = 0;
  private selfId = "";
  private localPlayerState?: PlayerState;
  private mapTiles: MapTile[] = [];
  private mapOrigin = { x: 0, y: 0 };
  private campusLayer!: Phaser.GameObjects.Container;
  private sifaxInteriorLayer!: Phaser.GameObjects.Container;

  constructor() {
    super("MainScene");
  }

  preload() {
    this.mapOrigin = this.getMapOrigin();
    this.mapTiles = this.getVisibleMapTiles();

    for (const tile of this.mapTiles) {
      if (this.textures.exists(tile.key)) continue;
      const url = OSM_TILE_URL.replace("{z}", String(MAP_ZOOM))
        .replace("{x}", String(tile.x))
        .replace("{y}", String(tile.y));
      this.load.image(tile.key, url);
    }
  }

  create() {
    this.drawMap();
    this.createControls();
    this.createHud();

    this.connection = new GameConnection(
      (players, selfId) => this.applyPlayers(players, selfId),
      (status) => {
        if (this.connectionText.active) this.connectionText.setText(`Session: ${status}`);
      },
      (text, tone) => this.showToast(text, tone),
    );
    this.connection.connect();
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.connection.disconnect());

    this.add
      .text(20, 18, "LAUTECH LIFE", {
        fontFamily: "Arial, sans-serif",
        fontSize: "26px",
        color: "#fff7df",
        fontStyle: "bold",
        backgroundColor: "#202522",
        padding: { x: 10, y: 6 },
      })
      .setScrollFactor(0)
      .setDepth(1000);

    this.add
      .text(20, 65, "WASD / arrow keys to walk", {
        fontFamily: "Arial, sans-serif",
        fontSize: "15px",
        color: "#fff7df",
        backgroundColor: "#202522",
        padding: { x: 8, y: 5 },
      })
      .setScrollFactor(0)
      .setDepth(1000);
  }

  update(_time: number, delta: number) {
    const direction = new Phaser.Math.Vector2(
      Number(this.movementKeys.D.isDown || this.movementKeys.RIGHT.isDown) -
        Number(this.movementKeys.A.isDown || this.movementKeys.LEFT.isDown),
      Number(this.movementKeys.S.isDown || this.movementKeys.DOWN.isDown) -
        Number(this.movementKeys.W.isDown || this.movementKeys.UP.isDown),
    );

    if (direction.lengthSq() > 0) direction.normalize();
    this.connection?.setInput(direction.x, direction.y);

    this.toastTime = Math.max(0, this.toastTime - delta);
    this.toastText.setVisible(this.toastTime > 0);

    this.updateNearbyInteraction();
  }

  private updateNearbyInteraction() {
    const actor = this.playerActors.get(this.selfId);
    const location = this.localPlayerState?.location ?? LOCATION.campus;
    if (!actor) {
      this.sifaxPrompt.setVisible(false);
      return;
    }

    let nearby = false;
    let prompt = "";

    if (location === LOCATION.campus) {
      nearby =
        Phaser.Math.Distance.Between(
          actor.x,
          actor.y,
          WORLD.sifaxDoorX,
          WORLD.sifaxDoorY,
        ) <= WORLD.sifaxRadius;
      prompt = "Press E: Enter Sifax Hall";
    } else {
      const nearExit =
        Phaser.Math.Distance.Between(
          actor.x,
          actor.y,
          WORLD.interiorExitX,
          WORLD.interiorExitY,
        ) <= WORLD.interactionRadius;
      const nearLectern =
        Phaser.Math.Distance.Between(
          actor.x,
          actor.y,
          WORLD.lecternX,
          WORLD.lecternY,
        ) <= WORLD.interactionRadius;

      if (nearExit) {
        nearby = true;
        prompt = "Press E: Exit Sifax Hall";
      } else if (nearLectern) {
        nearby = true;
        prompt = this.localPlayerState?.classesAttended
          ? "Lecture attended this session"
          : "Press E: Attend lecture";
      }
    }

    this.sifaxPrompt.setText(prompt).setVisible(nearby);
    const canInteract = location === LOCATION.campus || !this.localPlayerState?.classesAttended;
    if (nearby && canInteract && Phaser.Input.Keyboard.JustDown(this.interactionKey)) {
      this.connection.interact();
    }
  }

  private createHud() {
    this.connectionText = this.add
      .text(20, 102, "Session: connecting", {
        fontFamily: "Arial, sans-serif",
        fontSize: "15px",
        color: "#fff7df",
        backgroundColor: "#202522",
        padding: { x: 8, y: 5 },
      })
      .setScrollFactor(0)
      .setDepth(1000);

    this.statsText = this.add
      .text(20, 145, "Cash ₦5,000  |  Hunger 70%  |  Classes 0/1", {
        fontFamily: "Arial, sans-serif",
        fontSize: "15px",
        color: "#fff7df",
        backgroundColor: "#202522",
        padding: { x: 8, y: 5 },
      })
      .setScrollFactor(0)
      .setDepth(1000);

    this.sifaxPrompt = this.add
      .text(WORLD_WIDTH / 2, WORLD_HEIGHT - 16, "Press E: Attend lecture at Sifax Hall", {
        fontFamily: "Arial, sans-serif",
        fontSize: "16px",
        color: "#fff7df",
        backgroundColor: "#202522",
        padding: { x: 12, y: 7 },
      })
      .setOrigin(0.5, 1)
      .setScrollFactor(0)
      .setDepth(1000)
      .setVisible(false);

    this.toastText = this.add
      .text(WORLD_WIDTH / 2, WORLD_HEIGHT - 65, "", {
        fontFamily: "Arial, sans-serif",
        fontSize: "16px",
        color: "#ffffff",
        backgroundColor: "#202522",
        padding: { x: 12, y: 7 },
      })
      .setOrigin(0.5, 1)
      .setScrollFactor(0)
      .setDepth(1000)
      .setVisible(false);
  }

  private showToast(text: string, tone: "success" | "error") {
    this.toastText.setText(text);
    this.toastText.setColor(tone === "success" ? "#d7f3a8" : "#ffd1bd");
    this.toastTime = 2400;
    this.toastText.setVisible(true);
  }

  private applyPlayers(players: PlayerState[], selfId: string) {
    if (selfId) this.selfId = selfId;
    const activeIds = new Set(players.map((player) => player.id));
    const localPlayer = players.find((player) => player.id === this.selfId);
    if (localPlayer) {
      this.localPlayerState = localPlayer;
      const insideSifax = localPlayer.location === LOCATION.sifax;
      this.campusLayer.setVisible(!insideSifax);
      this.sifaxInteriorLayer.setVisible(insideSifax);
      this.statsText.setText(
        `Cash ₦${localPlayer.money.toLocaleString("en-NG")}  |  Hunger ${localPlayer.hunger}%  |  Classes ${localPlayer.classesAttended}/1`,
      );
    }

    for (const player of players) {
      let actor = this.playerActors.get(player.id);
      if (!actor) {
        actor = this.createPlayer(player.id === this.selfId, player.id);
        this.playerActors.set(player.id, actor);
      }

      actor.setPosition(player.x, player.y);
      actor.setDepth(500 + player.y / WORLD_HEIGHT);
      actor.setVisible(player.location === (localPlayer?.location ?? LOCATION.campus));
    }

    for (const [id, actor] of this.playerActors) {
      if (activeIds.has(id)) continue;
      actor.destroy();
      this.playerActors.delete(id);
    }
  }

  private getMapOrigin() {
    return getMapOrigin(SIFAX_HALL, MAP_ZOOM, WORLD_WIDTH, WORLD_HEIGHT);
  }

  private getVisibleMapTiles(): MapTile[] {
    const firstTileX = Math.floor(this.mapOrigin.x / TILE_SIZE);
    const lastTileX = Math.floor((this.mapOrigin.x + WORLD_WIDTH - 1) / TILE_SIZE);
    const firstTileY = Math.floor(this.mapOrigin.y / TILE_SIZE);
    const lastTileY = Math.floor((this.mapOrigin.y + WORLD_HEIGHT - 1) / TILE_SIZE);
    const tiles: MapTile[] = [];

    for (let x = firstTileX; x <= lastTileX; x += 1) {
      for (let y = firstTileY; y <= lastTileY; y += 1) {
        tiles.push({ key: `osm-${MAP_ZOOM}-${x}-${y}`, x, y });
      }
    }

    return tiles;
  }

  private drawMap() {
    this.add.rectangle(0, 0, WORLD_WIDTH, WORLD_HEIGHT, 0x83966f).setOrigin(0);

    for (const tile of this.mapTiles) {
      if (!this.textures.exists(tile.key)) continue;

      this.add
        .image(
          tile.x * TILE_SIZE + TILE_SIZE / 2 - this.mapOrigin.x,
          tile.y * TILE_SIZE + TILE_SIZE / 2 - this.mapOrigin.y,
          tile.key,
        )
        .setDepth(1);
    }

    for (const landmark of CAMPUS_LANDMARKS) {
      const point = landmarkToScreen(
        landmark,
        SIFAX_HALL,
        MAP_ZOOM,
        WORLD_WIDTH,
        WORLD_HEIGHT,
      );
      this.add
        .circle(point.x, point.y, landmark.id === SIFAX_HALL.id ? 10 : 8, landmark.color)
        .setStrokeStyle(3, 0xffffff)
        .setDepth(5);
      this.add
        .text(point.x, point.y - 16, landmark.name.toUpperCase(), {
          fontFamily: "Arial, sans-serif",
          fontSize: "12px",
          color: "#ffffff",
          fontStyle: "bold",
          backgroundColor: "#202522",
          padding: { x: 5, y: 3 },
        })
        .setOrigin(0.5, 1)
        .setDepth(6);
    }
  }

  private createControls() {
    const keyboard = this.input.keyboard;
    if (!keyboard) return;

    this.movementKeys = keyboard.addKeys({
      W: Phaser.Input.Keyboard.KeyCodes.W,
      A: Phaser.Input.Keyboard.KeyCodes.A,
      S: Phaser.Input.Keyboard.KeyCodes.S,
      D: Phaser.Input.Keyboard.KeyCodes.D,
      UP: Phaser.Input.Keyboard.KeyCodes.UP,
      LEFT: Phaser.Input.Keyboard.KeyCodes.LEFT,
      DOWN: Phaser.Input.Keyboard.KeyCodes.DOWN,
      RIGHT: Phaser.Input.Keyboard.KeyCodes.RIGHT,
    }) as Record<string, Phaser.Input.Keyboard.Key>;
    this.interactionKey = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.E);
  }

  private createPlayer(isLocal: boolean, id: string) {
    const bodyColor = isLocal ? 0x176b5b : 0x3c6c9b;
    const capColor = isLocal ? 0xe9b949 : 0xf08a68;
    const body = this.add.rectangle(0, 3, 12, 16, bodyColor).setStrokeStyle(2, 0x123f38);
    const head = this.add.circle(0, -7, 5, 0x8d5738).setStrokeStyle(1, 0x603b2a);
    const cap = this.add.rectangle(0, -12, 11, 3, capColor);
    const name = this.add
      .text(0, -19, isLocal ? "YOU" : id.slice(0, 4), {
        fontFamily: "Arial, sans-serif",
        fontSize: "10px",
        color: "#ffffff",
        backgroundColor: "#202522",
        padding: { x: 3, y: 2 },
      })
      .setOrigin(0.5, 1);

    return this.add.container(0, 0, [body, head, cap, name]);
  }
}
