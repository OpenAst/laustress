export declare const WORLD: {
  readonly width: number;
  readonly height: number;
  readonly playerSpeed: number;
  readonly spawnX: number;
  readonly spawnY: number;
  readonly sifaxX: number;
  readonly sifaxY: number;
  readonly sifaxRadius: number;
  readonly sifaxDoorX: number;
  readonly sifaxDoorY: number;
  readonly interiorSpawnX: number;
  readonly interiorSpawnY: number;
  readonly interiorExitX: number;
  readonly interiorExitY: number;
  readonly lecternX: number;
  readonly lecternY: number;
  readonly interactionRadius: number;
  readonly roomMinX: number;
  readonly roomMaxX: number;
  readonly roomMinY: number;
  readonly roomMaxY: number;
  readonly startingMoney: number;
  readonly startingHunger: number;
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
};

export declare const LOCATION: {
  readonly campus: "campus";
  readonly sifax: "sifax";
};

export declare const MESSAGE: {
  readonly welcome: "welcome";
  readonly state: "state";
  readonly input: "input";
  readonly interact: "interact";
  readonly notice: "notice";
};

export interface PlayerState {
  id: string;
  x: number;
  y: number;
  money: number;
  hunger: number;
  classesAttended: number;
  location: "campus" | "sifax";
}

export type ClientMessage =
  | { type: "input"; x: number; y: number }
  | { type: "interact" };

export type ServerMessage =
  | { type: "welcome"; selfId: string; players: PlayerState[] }
  | { type: "state"; players: PlayerState[] }
  | { type: "notice"; text: string; tone: "success" | "error" };
