/** Double for lib/haptics.ts: the engine calls vibrate(), there is no motor here. */
export const HAPTIC = {
  tap: 12,
  success: [10, 40, 20],
  warning: [20, 60, 20],
  error: [30, 80, 30],
};

export const hapticLog = [];

export function vibrate(pattern = HAPTIC.tap) {
  hapticLog.push(pattern);
  return true;
}

export default vibrate;
