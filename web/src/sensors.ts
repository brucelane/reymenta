// Tilt and shake from the phone's motion sensors. iPhone asks permission, and only from a tap
// (DeviceMotionEvent.requestPermission), so start() must be called from the Join button's click.
//
// Two sources (2026-11-17: an old phone's tilt did nothing): the orientation event (gyroscope / rotation sensor)
// when the phone sends it, else the accelerometer's gravity vector (accelerationIncludingGravity), which nearly
// every phone has. Same for the shake: the linear acceleration when present (needs a gyroscope too), else the
// gravity vector's change. `motion.src` says which one is used (shown with ?debug).

export interface Motion { tx: number; ty: number; sh: number; src?: 'gyro' | 'accel' | 'none' }

type PermissionFn = () => Promise<'granted' | 'denied'>;

const params = new URLSearchParams(location.search);
/** ?demo in the address: simulated tilt and shake (screenshots, trying it on a computer). */
export const demoMotion = params.has('demo');
/** ?debug in the address: the page shows the sensor source and raw values. */
export const debugSensors = params.has('debug');

export async function requestMotionPermission(): Promise<boolean> {
  if (demoMotion) return true;
  const dm = (globalThis as { DeviceMotionEvent?: { requestPermission?: PermissionFn } }).DeviceMotionEvent;
  const dor = (globalThis as { DeviceOrientationEvent?: { requestPermission?: PermissionFn } }).DeviceOrientationEvent;
  try {
    if (dm?.requestPermission && (await dm.requestPermission()) !== 'granted') return false;
    if (dor?.requestPermission && (await dor.requestPermission()) !== 'granted') return false;
  } catch {
    return false;
  }
  return 'DeviceOrientationEvent' in globalThis || 'DeviceMotionEvent' in globalThis;
}

const clamp = (v: number, lo = -1, hi = 1) => Math.min(hi, Math.max(lo, v));
const DEG = 180 / Math.PI;
const G = 9.81;

/** Tilt in the orientation event's terms from the gravity vector (spec axes: flat face up = (0, 0, +g)). */
function tiltFromGravity(x: number, y: number, z: number): { beta: number; gamma: number } {
  return {
    beta: Math.atan2(y, z) * DEG,                    // 90 when held upright, 0 when flat
    gamma: Math.atan2(-x, Math.hypot(y, z)) * DEG,   // + when the right edge goes down
  };
}

/** Listens to the sensors; `motion` is updated in place. Returns a stop function. */
export function startMotion(motion: Motion): () => void {
  if (demoMotion) {
    const t0 = Date.now();
    const timer = setInterval(() => {
      const t = (Date.now() - t0) / 1000;
      motion.tx = Math.sin(t * 0.7) * 0.6;
      motion.ty = Math.cos(t * 0.5) * 0.4;
      motion.sh = Math.max(0, Math.sin(t * 1.3)) ** 6;
    }, 50);
    return () => clearInterval(timer);
  }
  motion.src = 'none';
  const setTilt = (beta: number, gamma: number) => {
    motion.tx = clamp(gamma / 45);        // left/right, ±45° = full
    motion.ty = clamp((beta - 45) / 45);  // front/back around a phone held at 45°
  };
  let lastGyro = 0;
  const onOrientation = (e: DeviceOrientationEvent) => {
    if (e.gamma == null || e.beta == null) return;
    lastGyro = Date.now();
    motion.src = 'gyro';
    setTilt(e.beta, e.gamma);
  };
  let energy = 0;
  let prev: [number, number, number] | undefined;
  const onMotion = (e: DeviceMotionEvent) => {
    const a = e.acceleration;
    const ag = e.accelerationIncludingGravity;
    let push = -1;
    if (a && a.x != null && a.y != null && a.z != null) {
      push = Math.hypot(a.x, a.y, a.z);                 // m/s², gravity already removed
    } else if (ag && ag.x != null && ag.y != null && ag.z != null) {
      // no linear acceleration: how much the gravity vector jumped since the last event
      const now: [number, number, number] = [ag.x, ag.y, ag.z];
      if (prev) push = Math.hypot(now[0] - prev[0], now[1] - prev[1], now[2] - prev[2]) * 1.5;
      prev = now;
    }
    if (push >= 0) {
      energy = Math.max(energy * 0.92, clamp(push / 25, 0, 1));
      motion.sh = energy < 0.02 ? 0 : energy;
    }
    // tilt from gravity when the orientation event hasn't come for a second (no gyroscope)
    if (Date.now() - lastGyro > 1000 && ag && ag.x != null && ag.y != null && ag.z != null && Math.hypot(ag.x, ag.y, ag.z) > G * 0.5) {
      const { beta, gamma } = tiltFromGravity(ag.x, ag.y, ag.z);
      motion.src = 'accel';
      setTilt(beta, gamma);
    }
  };
  addEventListener('deviceorientation', onOrientation);
  addEventListener('devicemotion', onMotion);
  // the shake decays even when no motion event comes
  const decay = setInterval(() => { energy *= 0.9; if (energy < 0.02) { energy = 0; motion.sh = 0; } }, 100);
  return () => {
    removeEventListener('deviceorientation', onOrientation);
    removeEventListener('devicemotion', onMotion);
    clearInterval(decay);
  };
}
