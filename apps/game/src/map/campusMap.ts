export type CampusLandmark = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  color: number;
};

export const SIFAX_HALL: CampusLandmark = {
  id: "sifax-hall",
  name: "Sifax Hall",
  latitude: 8.1702499,
  longitude: 4.2655803,
  color: 0xb13e31,
};

export const CAMPUS_LANDMARKS: CampusLandmark[] = [
  SIFAX_HALL,
  {
    id: "scsn-lecture-shed",
    name: "SCSN Lecture Shed",
    latitude: 8.169385,
    longitude: 4.26656,
    color: 0x297c65,
  },
];

const TILE_SIZE = 256;

function toMapPixels(latitude: number, longitude: number, zoom: number) {
  const scale = 2 ** zoom * TILE_SIZE;
  const latitudeRadians = (latitude * Math.PI) / 180;
  const sinLatitude = Math.sin(latitudeRadians);

  return {
    x: ((longitude + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + sinLatitude) / (1 - sinLatitude)) / (4 * Math.PI)) * scale,
  };
}

export function getMapOrigin(
  center: CampusLandmark,
  zoom: number,
  width: number,
  height: number,
) {
  const centerPixels = toMapPixels(center.latitude, center.longitude, zoom);
  return { x: centerPixels.x - width / 2, y: centerPixels.y - height / 2 };
}

export function landmarkToScreen(
  landmark: CampusLandmark,
  center: CampusLandmark,
  zoom: number,
  width: number,
  height: number,
) {
  const locationPixels = toMapPixels(landmark.latitude, landmark.longitude, zoom);
  const origin = getMapOrigin(center, zoom, width, height);
  return { x: locationPixels.x - origin.x, y: locationPixels.y - origin.y };
}
