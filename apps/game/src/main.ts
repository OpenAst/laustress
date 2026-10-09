import Phaser from "phaser";
import { MainScene } from "./scenes/MainScene";
import "./style.css";

new Phaser.Game({
  type: Phaser.AUTO,

  parent: "app",

  width: 960,
  height: 640,

  backgroundColor: "#91a878",

  scene: [MainScene],

  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
});
