import Phaser from "phaser";

export function createPlayerActor(scene: Phaser.Scene, isLocal: boolean, id: string) {
  const bodyColor = isLocal ? 0x176b5b : 0x3c6c9b;
  const capColor = isLocal ? 0xe9b949 : 0xf08a68;
  const shadow = scene.add.ellipse(0, 12, 24, 10, 0x142018, 0.32);
  const standingPose = scene.add.container(0, 0, [
    scene.add.rectangle(0, 2, 17, 17, capColor).setStrokeStyle(1, 0x3c3023),
    scene.add.rectangle(-4, 12, 5, 8, 0x323d42),
    scene.add.rectangle(4, 12, 5, 8, 0x323d42),
    scene.add.rectangle(0, 2, 15, 17, bodyColor).setStrokeStyle(2, 0x123f38),
    scene.add.triangle(0, -6, -4, 0, 4, 0, 0, 5, 0xe8d8b8),
    scene.add.circle(0, -11, 6, 0x8d5738).setStrokeStyle(1, 0x603b2a),
    scene.add.ellipse(0, -15, 12, 7, 0x302720),
    scene.add.rectangle(0, -18, 12, 4, capColor).setStrokeStyle(1, 0x463824),
  ]);
  const seatedPose = scene.add.container(0, 0, [
    scene.add.rectangle(0, 3, 15, 13, bodyColor).setStrokeStyle(2, 0x123f38),
    scene.add.triangle(0, -3, -4, 0, 4, 0, 0, 4, 0xe8d8b8),
    scene.add.circle(0, -9, 6, 0x8d5738).setStrokeStyle(1, 0x603b2a),
    scene.add.ellipse(0, -13, 12, 7, 0x302720),
    scene.add.rectangle(0, -16, 12, 4, capColor).setStrokeStyle(1, 0x463824),
    scene.add.rectangle(-7, 9, 12, 5, 0x323d42),
    scene.add.rectangle(7, 9, 12, 5, 0x323d42),
  ]).setVisible(false);
  const raisedHand = scene.add.container(10, -10, [
    scene.add.rectangle(0, -8, 5, 17, 0x8d5738).setAngle(-18),
    scene.add.circle(2, -18, 3, 0x8d5738),
  ]).setVisible(false);
  const handshakeArm = scene.add.container(8, 0, [
    scene.add.rectangle(5, 0, 15, 5, 0x8d5738),
    scene.add.circle(14, 0, 3, 0x8d5738),
  ]).setVisible(false);
  const name = scene.add.text(0, -27, isLocal ? "YOU" : id.slice(0, 4), {
    fontFamily: "Arial, sans-serif", fontSize: "9px", color: "#ffffff", backgroundColor: "#202522",
    padding: { x: 3, y: 2 },
  }).setOrigin(0.5, 1);

  const actor = scene.add.container(0, 0, [shadow, standingPose, seatedPose, raisedHand, handshakeArm, name]);
  actor.setData("standingPose", standingPose);
  actor.setData("seatedPose", seatedPose);
  actor.setData("raisedHand", raisedHand);
  actor.setData("handshakeArm", handshakeArm);
  return actor;
}

export function playHandshake(scene: Phaser.Scene, arm: Phaser.GameObjects.Container, direction: number) {
  scene.tweens.killTweensOf(arm);
  scene.tweens.add({
    targets: arm,
    angle: direction * 18,
    duration: 90,
    yoyo: true,
    repeat: 2,
    onComplete: () => arm.setAngle(0),
  });
}
