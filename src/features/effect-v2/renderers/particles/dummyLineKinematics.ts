import * as THREE from "three";

export interface DummyLineSpan {
  /** C++ _vDummyPos: dummy2 position in raw runtime axes. */
  start: THREE.Vector3;
  /** C++ _vDummyDir: normalized dummy1 - dummy2 in raw runtime axes. */
  direction: THREE.Vector3;
  /** C++ _fDummyDist: distance between dummy1 and dummy2 in PKO world space. */
  distance: number;
}

export function computeDummySpanFromPkoEndpoints(
  dummy1: THREE.Vector3,
  dummy2: THREE.Vector3,
): DummyLineSpan | null {
  const pkoDirection = dummy1.clone().sub(dummy2);
  const distance = pkoDirection.length();
  if (distance <= 0) return null;

  pkoDirection.normalize();
  return {
    start: dummy2.clone(),
    direction: pkoDirection,
    distance,
  };
}

export function computeDummySpawnPosition(
  span: DummyLineSpan,
  particleCount: number,
  random: () => number = Math.random,
): THREE.Vector3 {
  if (span.distance === 0 || particleCount <= 0) return span.start.clone();

  const bucket = Math.floor(random() * particleCount);
  const dist = bucket * (span.distance / particleCount);
  return span.start.clone().addScaledVector(span.direction, dist);
}

export function computeLineSingleVelocity(span: DummyLineSpan, life: number): THREE.Vector3 {
  if (life <= 0) return new THREE.Vector3();
  return span.direction.clone().multiplyScalar(span.distance / life);
}

export function computeLineRoundVelocity(span: DummyLineSpan, life: number): THREE.Vector3 {
  if (life <= 0) return new THREE.Vector3();
  return span.direction.clone().multiplyScalar((span.distance / life) * 2);
}

export function computeLineSingleDelta(
  velocity: THREE.Vector3,
  acceleration: THREE.Vector3,
  dt: number,
): THREE.Vector3 {
  return velocity.clone().multiplyScalar(dt).addScaledVector(acceleration, 0.5 * dt * dt);
}

export function computeDummyMovementDelta(
  direction: THREE.Vector3,
  acceleration: THREE.Vector3,
  velocity: number,
  dt: number,
  random: () => number = Math.random,
): THREE.Vector3 {
  const signedAccel = random() < 0.5 ? 1 : -1;
  return direction.clone()
    .multiplyScalar(velocity * dt)
    .addScaledVector(acceleration, signedAccel * dt);
}
