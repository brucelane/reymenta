// Tilt and shake from the phone's motion sensors. iPhone asks permission, and only from a tap
// (DeviceMotionEvent.requestPermission), so start() must be called from the Join button's click.

export interface Motion { tx: number; ty: number; sh: number }

type PermissionFn = () => Promise<'granted' | 'denied'>;

export async function requestMotionPermission(): Promise<boolean> {
  const dm = (globalThis as { DeviceMotionEvent?: { requestPermission?: PermissionFn } }).DeviceMotionEvent;
  const dor = (globalThis as { DeviceOrientationEvent?: { requestPermission?: PermissionFn } }).DeviceOrientationEvent;
  try {
    if (dm?.requestPermission && (await dm.requestPermission()) !== 'granted') return false;
    if (dor?.requestPermission && (await dor.requestPermission()) !== 'granted') return false;
  } catch {
    return false;
  }
  return 'DeviceOrientationEvent' in globalThis;
}

const clamp = (v: number, lo = -1, hi = 1) => Math.min(hi, Math.max(lo, v));

/** Listens to the sensors; `motion` is updated in place. Returns a stop function. */
export function startMotion(motion: Motion): () => void {
  const onOrientation = (e: DeviceOrientationEvent) => {
    if (e.gamma == null || e.beta == null) return;
    motion.tx = clamp(e.gamma / 45);        // left/right, ±45° = full
    motion.ty = clamp((e.beta - 45) / 45);  // front/back around a phone held at 45°
  };
  let energy = 0;
  const onMotion = (e: DeviceMotionEvent) => {
    const a = e.acceleration;
    if (!a || a.x == null || a.y == null || a.z == null) return;
    const g = Math.hypot(a.x, a.y, a.z);           // m/s², gravity already removed
    energy = Math.max(energy * 0.92, clamp(g / 25, 0, 1));
    motion.sh = energy < 0.02 ? 0 : energy;
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
