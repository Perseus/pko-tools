import * as THREE from "three";

export function setPkoTextureFactorColor(
  target: THREE.Color,
  red: number,
  green: number,
  blue: number,
): void {
  target.setRGB(red, green, blue, THREE.SRGBColorSpace);
}

export function createPkoTextureFactorColor(
  red: number,
  green: number,
  blue: number,
): THREE.Color {
  const color = new THREE.Color();
  setPkoTextureFactorColor(color, red, green, blue);
  return color;
}
