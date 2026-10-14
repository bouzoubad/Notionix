// Test windows often sit behind other windows while the suite runs. Chromium then
// throttles their timers and pauses animation frames, which delays menus that
// appear after a timer (bubble menus) or on hover. Users interact with a visible
// window, so these switches only make the tests independent of window stacking.
export const CHROMIUM_FLAGS = [
  '--disable-renderer-backgrounding',
  '--disable-backgrounding-occluded-windows',
  '--disable-background-timer-throttling'
]
