// Timers in a Worker are not throttled when the tab is in the background, unlike
// requestAnimationFrame and main-thread timers. The compositor draws one frame per tick.
let timer: ReturnType<typeof setInterval> | undefined;

self.onmessage = (event: MessageEvent<number>) => {
  clearInterval(timer);
  timer = setInterval(() => self.postMessage(0), event.data);
};
