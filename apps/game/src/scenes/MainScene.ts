import Phaser from "phaser";
import { GameConnection } from "../network/GameConnection";
import { CAMPUS_LANDMARKS, getMapOrigin, landmarkToScreen, SIFAX_HALL } from "../map/campusMap";
import { CLASSROOM_ACTIVITY, LOCATION, PLAYER_ACTION, SIFAX_DESKS, SIFAX_LECTURER, SIFAX_SEATS, WORLD } from "../../../../packages/shared/src/protocol.js";
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
  private standKey!: Phaser.Input.Keyboard.Key;
  private raiseHandKey!: Phaser.Input.Keyboard.Key;
  private handshakeKey!: Phaser.Input.Keyboard.Key;
  private playerActors = new Map<string, Phaser.GameObjects.Container>();
  private players: PlayerState[] = [];
  private lastHandshakeEmote = new Map<string, number>();
  private lastHandRaiseCount = new Map<string, number>();
  private lastAnsweredQuestionId = new Map<string, number>();
  private lastAttendanceCount = new Map<string, number>();
  private connection!: GameConnection;
  private connectionText!: Phaser.GameObjects.Text;
  private statsText!: Phaser.GameObjects.Text;
  private participationText!: Phaser.GameObjects.Text;
  private sifaxPrompt!: Phaser.GameObjects.Text;
  private toastText!: Phaser.GameObjects.Text;
  private classActivityPanel!: Phaser.GameObjects.Container;
  private classActivityStatus!: Phaser.GameObjects.Text;
  private lecturerActor!: Phaser.GameObjects.Container;
  private lecturerBubble!: Phaser.GameObjects.Text;
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
    if (!actor) {
      this.sifaxPrompt.setVisible(false);
      return;
    }

    const location = this.localPlayerState?.location ?? LOCATION.campus;
    const isInside = location === LOCATION.sifax;
    const isSeated = Boolean(this.localPlayerState?.seatId);
    if (isInside && isSeated && Phaser.Input.Keyboard.JustDown(this.raiseHandKey)) {
      this.connection.performAction(
        this.localPlayerState?.handRaised ? PLAYER_ACTION.lowerHand : PLAYER_ACTION.raiseHand,
      );
    }
    if (isInside && isSeated && Phaser.Input.Keyboard.JustDown(this.standKey)) {
      this.connection.performAction(PLAYER_ACTION.stand);
    }
    if (isInside && Phaser.Input.Keyboard.JustDown(this.handshakeKey)) {
      this.connection.performAction(PLAYER_ACTION.handshake);
    }

    let nearby = false;
    let prompt = "";
    let action: "interact" | "sit" | null = null;
    const nearbyFriend = this.players.find(
      (player) =>
        player.id !== this.selfId &&
        player.location === location &&
        Phaser.Math.Distance.Between(actor.x, actor.y, player.x, player.y) <= WORLD.handshakeRadius,
    );

    if (!isInside) {
      nearby =
        Phaser.Math.Distance.Between(
          actor.x,
          actor.y,
          WORLD.sifaxDoorX,
          WORLD.sifaxDoorY,
        ) <= WORLD.sifaxRadius;
      prompt = "Press E: Enter Sifax Hall";
      action = "interact";
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
        action = "interact";
      } else if (nearLectern) {
        nearby = true;
        prompt = this.localPlayerState?.classesAttended
          ? "Lecture attended this session"
          : "Press E: Attend lecture";
        if (!this.localPlayerState?.classesAttended) action = "interact";
      } else if (isSeated) {
        nearby = true;
        prompt = this.localPlayerState?.handRaised
          ? "H lower hand  ·  Space stand  ·  F shake hands"
          : "H raise hand  ·  Space stand  ·  F shake hands";
      } else {
        const openSeatNearby = SIFAX_SEATS.some(
          (seat) =>
            !this.players.some((player) => player.seatId === seat.id) &&
            Phaser.Math.Distance.Between(actor.x, actor.y, seat.x, seat.y) <= WORLD.seatInteractionRadius,
        );
        if (openSeatNearby) {
          nearby = true;
          prompt = "Press E: Take a seat  ·  F: Shake hands";
          action = "sit";
        } else if (nearbyFriend) {
          nearby = true;
          prompt = `Press F: Shake hands with ${nearbyFriend.id}`;
        }
      }
    }

    this.sifaxPrompt.setText(prompt).setVisible(nearby);
    if (nearby && action && Phaser.Input.Keyboard.JustDown(this.interactionKey)) {
      if (action === "sit") this.connection.performAction(PLAYER_ACTION.sit);
      else this.connection.interact();
    }
  }

  private createHud() {
    this.add.rectangle(178, 96, 332, 154, 0x12231f, 0.94)
      .setStrokeStyle(2, 0xd6b15d)
      .setScrollFactor(0)
      .setDepth(990);
    this.add.rectangle(178, 39, 332, 38, 0x27493e)
      .setScrollFactor(0)
      .setDepth(991);
    this.add
      .text(34, 25, "LAUTECH LIFE", {
        fontFamily: "Arial, sans-serif",
        fontSize: "21px",
        color: "#fff7df",
        fontStyle: "bold",
        letterSpacing: 1,
      })
      .setScrollFactor(0)
      .setDepth(1000);
    this.add
      .text(34, 55, "SIFAX HALL  /  CAMPUS STORIES", {
        fontFamily: "Arial, sans-serif",
        fontSize: "10px",
        color: "#e9c66e",
        fontStyle: "bold",
        letterSpacing: 1,
      })
      .setScrollFactor(0)
      .setDepth(1000);

    this.connectionText = this.add
      .text(34, 91, "●  Connecting to session…", {
        fontFamily: "Arial, sans-serif",
        fontSize: "13px",
        color: "#d8e6d5",
      })
      .setScrollFactor(0)
      .setDepth(1000);

    this.statsText = this.add
      .text(34, 123, "₦5,000  ·  Hunger 70%  ·  Classes 0/1", {
        fontFamily: "Arial, sans-serif",
        fontSize: "12px",
        color: "#fff7df",
      })
      .setScrollFactor(0)
      .setDepth(1000);

    this.participationText = this.add
      .text(34, 143, "Participation: 0", {
        fontFamily: "Arial, sans-serif",
        fontSize: "11px",
        color: "#e9c66e",
        fontStyle: "bold",
      })
      .setScrollFactor(0)
      .setDepth(1000);

    this.add
      .text(34, 164, "WASD / ARROWS  MOVE     E  INTERACT", {
        fontFamily: "Arial, sans-serif",
        fontSize: "10px",
        color: "#b4c5b5",
        fontStyle: "bold",
        letterSpacing: 0.5,
      })
      .setScrollFactor(0)
      .setDepth(1000);

    this.sifaxPrompt = this.add
      .text(WORLD_WIDTH / 2, WORLD_HEIGHT - 16, "Press E: Attend lecture at Sifax Hall", {
        fontFamily: "Arial, sans-serif",
        fontSize: "15px",
        color: "#fff7df",
        fontStyle: "bold",
        backgroundColor: "#27493e",
        padding: { x: 15, y: 9 },
      })
      .setOrigin(0.5, 1)
      .setScrollFactor(0)
      .setDepth(1000)
      .setVisible(false);

    this.classActivityStatus = this.add.text(18, 75, "Sit and press H to answer  ·  +1 point", {
      fontFamily: "Arial, sans-serif",
      fontSize: "10px",
      color: "#e9c66e",
      fontStyle: "bold",
    });
    this.classActivityPanel = this.add.container(550, 18, [
      this.add.rectangle(195, 46, 390, 90, 0x12231f, 0.96).setStrokeStyle(2, 0xd6b15d),
      this.add.text(18, 15, "TODAY'S CLASS QUESTION", {
        fontFamily: "Arial, sans-serif",
        fontSize: "12px",
        color: "#e9c66e",
        fontStyle: "bold",
        letterSpacing: 0.5,
      }),
      this.add.text(18, 35, CLASSROOM_ACTIVITY.prompt, {
        fontFamily: "Arial, sans-serif",
        fontSize: "13px",
        color: "#fff7df",
        wordWrap: { width: 350 },
      }),
      this.classActivityStatus,
    ]).setScrollFactor(0).setDepth(1010).setVisible(false);

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
    this.players = players;
    if (selfId) this.selfId = selfId;
    const activeIds = new Set(players.map((player) => player.id));
    const localPlayer = players.find((player) => player.id === this.selfId);
    if (localPlayer) {
      this.localPlayerState = localPlayer;
      const insideSifax = localPlayer.location === LOCATION.sifax;
      this.campusLayer.setVisible(!insideSifax);
      this.sifaxInteriorLayer.setVisible(insideSifax);
      this.classActivityPanel.setVisible(insideSifax);
      this.classActivityStatus.setText(
        localPlayer.answeredQuestionId === CLASSROOM_ACTIVITY.questionId
          ? "Answered  ·  +1 participation earned"
          : "Sit and press H to answer  ·  +1 point",
      );
      this.statsText.setText(
        `Cash ₦${localPlayer.money.toLocaleString("en-NG")}  |  Hunger ${localPlayer.hunger}%  |  Classes ${localPlayer.classesAttended}/1`,
      );
      this.participationText.setText(`Participation: ${localPlayer.participationPoints}`);
    }

    for (const player of players) {
      const previousHandRaises = this.lastHandRaiseCount.get(player.id);
      if (previousHandRaises === undefined) {
        this.lastHandRaiseCount.set(player.id, player.handRaiseCount);
        this.lastAnsweredQuestionId.set(player.id, player.answeredQuestionId);
      } else if (player.handRaiseCount > previousHandRaises) {
        this.lastHandRaiseCount.set(player.id, player.handRaiseCount);
        const justEarnedPoint =
          player.answeredQuestionId === CLASSROOM_ACTIVITY.questionId &&
          this.lastAnsweredQuestionId.get(player.id) !== CLASSROOM_ACTIVITY.questionId;
        this.showLecturerResponse(
          justEarnedPoint
            ? "Good point. You earned one participation credit."
            : player.id === this.selfId
              ? "Yes? Go ahead with your question."
              : "The lecturer calls on a student.",
        );
      }
      this.lastAnsweredQuestionId.set(player.id, player.answeredQuestionId);

      const previousAttendance = this.lastAttendanceCount.get(player.id);
      if (previousAttendance === undefined) {
        this.lastAttendanceCount.set(player.id, player.classesAttended);
      } else if (player.classesAttended > previousAttendance) {
        this.lastAttendanceCount.set(player.id, player.classesAttended);
        this.showLecturerResponse("Good work. You're marked present.");
      }

      let actor = this.playerActors.get(player.id);
      if (!actor) {
        actor = this.createPlayer(player.id === this.selfId, player.id);
        this.playerActors.set(player.id, actor);
      }

      actor.setPosition(player.x, player.y);
      actor.setDepth(500 + player.y / WORLD_HEIGHT);
      actor.setVisible(player.location === (localPlayer?.location ?? LOCATION.campus));
      actor.getData("standingPose").setVisible(!player.seatId);
      actor.getData("seatedPose").setVisible(Boolean(player.seatId));
      actor.getData("raisedHand").setVisible(Boolean(player.seatId && player.handRaised));

      if (player.emote === "handshake" && player.emoteUntil > Date.now()) {
        const handshakeArm = actor.getData("handshakeArm") as Phaser.GameObjects.Container;
        const friend = players.find(
          (other) => other.id !== player.id && other.emoteUntil === player.emoteUntil,
        );
        const direction = friend && friend.x < player.x ? -1 : 1;
        handshakeArm.setVisible(true).setX(direction * 8).setScale(direction, 1);
        const previousEmote = this.lastHandshakeEmote.get(player.id);
        if (previousEmote !== player.emoteUntil) {
          this.lastHandshakeEmote.set(player.id, player.emoteUntil);
          this.playHandshake(handshakeArm, direction);
        }
      } else {
        actor.getData("handshakeArm").setVisible(false);
      }
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
    this.campusLayer = this.add.container(0, 0).setDepth(0);
    this.sifaxInteriorLayer = this.add.container(0, 0).setDepth(0).setVisible(false);

    this.drawCampus();
    this.drawSifaxInterior();
  }

  private drawCampus() {
    const add = this.campusLayer;
    add.add(this.add.rectangle(0, 0, WORLD_WIDTH, WORLD_HEIGHT, 0x83966f).setOrigin(0));

    for (const tile of this.mapTiles) {
      if (!this.textures.exists(tile.key)) continue;

      add.add(this.add
        .image(
          tile.x * TILE_SIZE + TILE_SIZE / 2 - this.mapOrigin.x,
          tile.y * TILE_SIZE + TILE_SIZE / 2 - this.mapOrigin.y,
          tile.key,
        ));
    }

    for (const landmark of CAMPUS_LANDMARKS) {
      const point = landmarkToScreen(
        landmark,
        SIFAX_HALL,
        MAP_ZOOM,
        WORLD_WIDTH,
        WORLD_HEIGHT,
      );
      if (landmark.id === SIFAX_HALL.id) {
        this.drawSifaxExterior(point.x, point.y);
        continue;
      }

      add.add(this.add
        .circle(point.x, point.y, 8, landmark.color)
        .setStrokeStyle(3, 0xffffff));
      add.add(this.add
        .text(point.x, point.y - 16, landmark.name.toUpperCase(), {
          fontFamily: "Arial, sans-serif",
          fontSize: "12px",
          color: "#ffffff",
          fontStyle: "bold",
          backgroundColor: "#202522",
          padding: { x: 5, y: 3 },
        })
        .setOrigin(0.5, 1));
    }
  }

  private drawSifaxExterior(x: number, y: number) {
    const add = this.campusLayer;

    // Courtyard and footpath visually connect the real map to the playable doorway.
    add.add(this.add.ellipse(x, y + 64, 326, 68, 0x263a2c, 0.25));
    add.add(this.add.rectangle(x, y + 130, 124, 140, 0xc9b38a, 0.94));
    add.add(this.add.rectangle(x, y + 70, 208, 46, 0xb49b70).setStrokeStyle(2, 0x8c795b));
    add.add(this.add.ellipse(x, y + 57, 318, 42, 0x40523d, 0.26));

    // Layered roof, bright trim and recessed facade give Sifax a stronger silhouette.
    add.add(this.add.rectangle(x, y + 7, 268, 122, 0x5d4538).setStrokeStyle(3, 0x3a3029));
    add.add(this.add.rectangle(x, y - 10, 252, 114, 0xd9c49a).setStrokeStyle(2, 0x9c835c));
    add.add(this.add.rectangle(x, y - 40, 280, 35, 0x9f3f32).setStrokeStyle(3, 0x592d28));
    add.add(this.add.rectangle(x, y - 20, 260, 9, 0x6f332d));
    add.add(this.add.rectangle(x, y - 53, 228, 8, 0xc77555));
    add.add(this.add.rectangle(x, y + 39, 252, 9, 0xead8b2));

    // Window frames, glass highlights and columns add detail without obscuring the map.
    for (const windowX of [x - 99, x - 60, x + 60, x + 99]) {
      add.add(this.add.rectangle(windowX, y + 3, 22, 34, 0x5b554c).setStrokeStyle(2, 0x78664c));
      add.add(this.add.rectangle(windowX, y + 3, 14, 26, 0x80abae));
      add.add(this.add.rectangle(windowX - 3, y - 2, 3, 20, 0xb8d6d2, 0.75));
      add.add(this.add.rectangle(windowX, y + 24, 27, 5, 0xb49b70));
    }
    for (const columnX of [x - 30, x + 30]) {
      add.add(this.add.rectangle(columnX, y + 14, 9, 45, 0xf0dfb7).setStrokeStyle(1, 0x927b57));
    }
    add.add(this.add.rectangle(x, y + 31, 38, 57, 0x49352e).setStrokeStyle(3, 0xe9b949));
    add.add(this.add.rectangle(x - 8, y + 31, 17, 50, 0x76503e));
    add.add(this.add.circle(x + 12, y + 32, 2, 0xe9b949));
    add.add(this.add.rectangle(x, y + 61, 64, 8, 0xc2a472).setStrokeStyle(2, 0x66513b));
    add.add(this.add.rectangle(x, y + 67, 98, 10, 0x9a8059));
    add.add(this.add.text(x, y - 69, "SIFAX HALL", {
      fontFamily: "Arial, sans-serif",
      fontSize: "15px",
      color: "#fff7df",
      fontStyle: "bold",
      backgroundColor: "#202522",
      padding: { x: 9, y: 5 },
    }).setOrigin(0.5, 1));

    // Small trees frame the approach, echoing the greenery around the hall.
    for (const treeX of [x - 174, x + 174]) {
      add.add(this.add.ellipse(treeX, y + 89, 42, 22, 0x263a2c, 0.25));
      add.add(this.add.circle(treeX, y + 78, 18, 0x366b49).setStrokeStyle(2, 0x245238));
      add.add(this.add.circle(treeX - 7, y + 72, 9, 0x4e8756));
      add.add(this.add.circle(treeX + 8, y + 76, 8, 0x61915b));
      add.add(this.add.rectangle(treeX, y + 91, 5, 12, 0x78533b));
    }
  }

  private drawSifaxInterior() {
    const add = this.sifaxInteriorLayer;
    add.add(this.add.rectangle(0, 0, WORLD_WIDTH, WORLD_HEIGHT, 0xcbb991).setOrigin(0));
    add.add(this.add.rectangle(28, 24, WORLD_WIDTH - 56, WORLD_HEIGHT - 48, 0xe4d5b4)
      .setStrokeStyle(12, 0x614d3d));
    add.add(this.add.rectangle(WORLD_WIDTH / 2, 35, WORLD_WIDTH - 92, 12, 0xa99069));

    // Floor tiles give the room scale and help the player read movement.
    const floor = this.add.graphics();
    floor.lineStyle(1, 0xb8a57f, 0.5);
    for (let x = 92; x < WORLD_WIDTH - 60; x += 48) floor.lineBetween(x, 68, x, 548);
    for (let y = 92; y < 548; y += 48) floor.lineBetween(60, y, WORLD_WIDTH - 60, y);
    add.add(floor);

    add.add(this.add.rectangle(WORLD_WIDTH / 2, 68, WORLD_WIDTH - 120, 24, 0x6e5946));
    add.add(this.add.rectangle(WORLD_WIDTH / 2, 68, WORLD_WIDTH - 142, 4, 0xd1ad67));
    add.add(this.add.text(WORLD_WIDTH / 2, 53, "SIFAX HALL  •  LECTURE ROOM", {
      fontFamily: "Arial, sans-serif",
      fontSize: "16px",
      color: "#fff7df",
      fontStyle: "bold",
    }).setOrigin(0.5));

    // A front board and lectern make the class activity visible from the doorway.
    add.add(this.add.rectangle(WORLD_WIDTH / 2, 116, 274, 48, 0x775b3b));
    add.add(this.add.rectangle(WORLD_WIDTH / 2, 114, 260, 40, 0x27493e).setStrokeStyle(3, 0xd1ad67));
    add.add(this.add.text(WORLD_WIDTH / 2, 114, "WELCOME TO CLASS", {
      fontFamily: "Arial, sans-serif",
      fontSize: "16px",
      color: "#fff7df",
      fontStyle: "bold",
    }).setOrigin(0.5));
    add.add(this.add.rectangle(WORLD.lecternX, WORLD.lecternY, 56, 34, 0x8e593a)
      .setStrokeStyle(3, 0x553725));
    add.add(this.add.rectangle(WORLD.lecternX, WORLD.lecternY - 17, 68, 9, 0x553725));
    add.add(this.add.text(WORLD.lecternX, WORLD.lecternY - 39, "LECTERN  •  PRESS E", {
      fontFamily: "Arial, sans-serif",
      fontSize: "12px",
      color: "#44372b",
      fontStyle: "bold",
      backgroundColor: "#f5ead2",
      padding: { x: 5, y: 3 },
    }).setOrigin(0.5, 1));

    this.drawLecturer(add);

    for (const desk of SIFAX_DESKS) {
      add.add(this.add.ellipse(desk.x, desk.y + 17, 86, 18, 0x574936, 0.18));
      add.add(this.add.rectangle(desk.x, desk.y, desk.width, desk.height, 0x805238)
        .setStrokeStyle(2, 0x543823));
      add.add(this.add.rectangle(desk.x, desk.y - 6, 66, 8, 0xb77a4d));
      add.add(this.add.rectangle(desk.x, desk.y + 18, 7, 10, 0x594632));
      add.add(this.add.rectangle(desk.x - 33, desk.y + 18, 5, 10, 0x594632));
      add.add(this.add.rectangle(desk.x + 33, desk.y + 18, 5, 10, 0x594632));
    }

    for (const seat of SIFAX_SEATS) {
      add.add(this.add.ellipse(seat.x, seat.y + 6, 30, 13, 0x574936, 0.22));
      add.add(this.add.rectangle(seat.x, seat.y - 8, 18, 7, 0x9b6846)
        .setStrokeStyle(1, 0x543823));
      add.add(this.add.rectangle(seat.x, seat.y + 1, 18, 16, 0x805238)
        .setStrokeStyle(2, 0x543823));
      add.add(this.add.rectangle(seat.x - 6, seat.y + 10, 3, 9, 0x594632));
      add.add(this.add.rectangle(seat.x + 6, seat.y + 10, 3, 9, 0x594632));
    }

    for (const windowY of [215, 330, 445]) {
      add.add(this.add.rectangle(54, windowY, 14, 62, 0x6b5844));
      add.add(this.add.rectangle(54, windowY, 7, 52, 0x91b7b2));
      add.add(this.add.rectangle(WORLD_WIDTH - 54, windowY, 14, 62, 0x6b5844));
      add.add(this.add.rectangle(WORLD_WIDTH - 54, windowY, 7, 52, 0x91b7b2));
    }
    add.add(this.add.rectangle(810, 150, 80, 48, 0x8d6847).setStrokeStyle(2, 0x68482f));
    add.add(this.add.text(810, 150, "TODAY\n9:00  LECTURE", {
      fontFamily: "Arial, sans-serif",
      fontSize: "9px",
      color: "#fff7df",
      align: "center",
      fontStyle: "bold",
    }).setOrigin(0.5));

    // Keep an obvious gap in the south wall for the exit door.
    add.add(this.add.rectangle(250, 560, 380, 18, 0x6e5946));
    add.add(this.add.rectangle(710, 560, 380, 18, 0x6e5946));
    add.add(this.add.rectangle(WORLD.interiorExitX, 560, 76, 10, 0xe9b949));
    add.add(this.add.text(WORLD.interiorExitX, 589, "EXIT  •  PRESS E", {
      fontFamily: "Arial, sans-serif",
      fontSize: "12px",
      color: "#44372b",
      fontStyle: "bold",
      backgroundColor: "#f5ead2",
      padding: { x: 5, y: 3 },
    }).setOrigin(0.5));
  }

  private drawLecturer(layer: Phaser.GameObjects.Container) {
    const { x, y } = SIFAX_LECTURER;
    const body = this.add.rectangle(0, 4, 20, 24, 0x31594a).setStrokeStyle(2, 0x1d3d33);
    const collar = this.add.triangle(0, -6, -5, 0, 5, 0, 0, 8, 0xf0e3cb);
    const tie = this.add.triangle(0, 2, -3, -1, 3, -1, 0, 11, 0xb14c3d);
    const head = this.add.circle(0, -13, 7, 0x855236).setStrokeStyle(1, 0x583925);
    const hair = this.add.ellipse(0, -18, 14, 7, 0x29251f);
    const glasses = this.add.graphics();
    glasses.lineStyle(1, 0x302a26, 1);
    glasses.strokeCircle(-3, -13, 2.5);
    glasses.strokeCircle(3, -13, 2.5);
    glasses.lineBetween(-0.5, -13, 0.5, -13);

    this.lecturerActor = this.add.container(x, y, [
      this.add.ellipse(0, 17, 31, 12, 0x574936, 0.2),
      this.add.rectangle(-12, 3, 6, 19, 0x55483e),
      this.add.rectangle(12, 3, 6, 19, 0x55483e),
      body,
      collar,
      tie,
      head,
      hair,
      glasses,
      this.add.text(0, -29, "LECTURER", {
        fontFamily: "Arial, sans-serif",
        fontSize: "9px",
        color: "#fff7df",
        fontStyle: "bold",
        backgroundColor: "#27493e",
        padding: { x: 4, y: 2 },
      }).setOrigin(0.5, 1),
    ]);
    layer.add(this.lecturerActor);

    this.lecturerBubble = this.add.text(x, y - 37, "", {
      fontFamily: "Arial, sans-serif",
      fontSize: "12px",
      color: "#24332a",
      fontStyle: "bold",
      align: "center",
      wordWrap: { width: 235 },
      backgroundColor: "#fff7df",
      padding: { x: 9, y: 7 },
    }).setOrigin(0.5, 1).setVisible(false);
    layer.add(this.lecturerBubble);
  }

  private showLecturerResponse(text: string) {
    if (!this.lecturerBubble || !this.lecturerActor) return;

    this.tweens.killTweensOf(this.lecturerBubble);
    this.lecturerBubble.setText(text).setAlpha(0).setVisible(true);
    this.tweens.add({
      targets: this.lecturerBubble,
      alpha: 1,
      duration: 160,
      hold: 2000,
      yoyo: true,
      onComplete: () => this.lecturerBubble.setVisible(false),
    });

    this.tweens.killTweensOf(this.lecturerActor);
    this.tweens.add({
      targets: this.lecturerActor,
      angle: -5,
      duration: 150,
      yoyo: true,
      repeat: 1,
      onComplete: () => this.lecturerActor.setAngle(0),
    });
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
    this.standKey = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
    this.raiseHandKey = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.H);
    this.handshakeKey = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.F);
  }

  private createPlayer(isLocal: boolean, id: string) {
    const bodyColor = isLocal ? 0x176b5b : 0x3c6c9b;
    const capColor = isLocal ? 0xe9b949 : 0xf08a68;
    const shadow = this.add.ellipse(0, 12, 24, 10, 0x142018, 0.32);
    const standingPose = this.add.container(0, 0, [
      this.add.rectangle(0, 2, 17, 17, capColor).setStrokeStyle(1, 0x3c3023),
      this.add.rectangle(-4, 12, 5, 8, 0x323d42),
      this.add.rectangle(4, 12, 5, 8, 0x323d42),
      this.add.rectangle(0, 2, 15, 17, bodyColor).setStrokeStyle(2, 0x123f38),
      this.add.triangle(0, -6, -4, 0, 4, 0, 0, 5, 0xe8d8b8),
      this.add.circle(0, -11, 6, 0x8d5738).setStrokeStyle(1, 0x603b2a),
      this.add.ellipse(0, -15, 12, 7, 0x302720),
      this.add.rectangle(0, -18, 12, 4, capColor).setStrokeStyle(1, 0x463824),
    ]);
    const seatedPose = this.add.container(0, 0, [
      this.add.rectangle(0, 3, 15, 13, bodyColor).setStrokeStyle(2, 0x123f38),
      this.add.triangle(0, -3, -4, 0, 4, 0, 0, 4, 0xe8d8b8),
      this.add.circle(0, -9, 6, 0x8d5738).setStrokeStyle(1, 0x603b2a),
      this.add.ellipse(0, -13, 12, 7, 0x302720),
      this.add.rectangle(0, -16, 12, 4, capColor).setStrokeStyle(1, 0x463824),
      this.add.rectangle(-7, 9, 12, 5, 0x323d42),
      this.add.rectangle(7, 9, 12, 5, 0x323d42),
    ]).setVisible(false);
    const raisedHand = this.add.container(10, -10, [
      this.add.rectangle(0, -8, 5, 17, 0x8d5738).setAngle(-18),
      this.add.circle(2, -18, 3, 0x8d5738),
    ]).setVisible(false);
    const handshakeArm = this.add.container(8, 0, [
      this.add.rectangle(5, 0, 15, 5, 0x8d5738),
      this.add.circle(14, 0, 3, 0x8d5738),
    ]).setVisible(false);
    const name = this.add
      .text(0, -27, isLocal ? "YOU" : id.slice(0, 4), {
        fontFamily: "Arial, sans-serif",
        fontSize: "9px",
        color: "#ffffff",
        backgroundColor: "#202522",
        padding: { x: 3, y: 2 },
      })
      .setOrigin(0.5, 1);

    const actor = this.add.container(0, 0, [shadow, standingPose, seatedPose, raisedHand, handshakeArm, name]);
    actor.setData("standingPose", standingPose);
    actor.setData("seatedPose", seatedPose);
    actor.setData("raisedHand", raisedHand);
    actor.setData("handshakeArm", handshakeArm);
    return actor;
  }

  private playHandshake(arm: Phaser.GameObjects.Container, direction: number) {
    this.tweens.killTweensOf(arm);
    this.tweens.add({
      targets: arm,
      angle: direction * 18,
      duration: 90,
      yoyo: true,
      repeat: 2,
      onComplete: () => arm.setAngle(0),
    });
  }
}
