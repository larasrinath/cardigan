/** A viewer's preferred details width, independent of the result and of a temporarily narrow window. */
export const DETAILS_WIDTH_KEY = "cardigan-details-width";
const DEFAULT_WIDTH = 620;
const MIN_WIDTH = 360;
const NARROW_WIDTH = 900;

export function resizeDetails(panel: HTMLElement, edge: HTMLElement): { refresh(): void; stop(): void } {
  let preferred = DEFAULT_WIDTH;
  try {
    const stored = Number(localStorage.getItem(DETAILS_WIDTH_KEY));
    if (Number.isFinite(stored) && stored >= MIN_WIDTH) preferred = stored;
  } catch { /* Storage can be unavailable; resizing still works for this page. */ }
  let drag: { id: number; x: number; width: number } | undefined;
  const maximum = (): number => Math.floor(window.innerWidth * 7 / 10);
  const width = (): number => Math.max(MIN_WIDTH, Math.min(preferred, maximum()));
  const refresh = (): void => {
    panel.style.setProperty("--details-width", `${width()}px`);
    edge.setAttribute("aria-valuemin", String(MIN_WIDTH));
    edge.setAttribute("aria-valuemax", String(Math.max(MIN_WIDTH, maximum())));
    edge.setAttribute("aria-valuenow", String(width()));
    edge.setAttribute("aria-valuetext", `${width()} pixels`);
    edge.hidden = window.innerWidth < NARROW_WIDTH;
    if (edge.hidden) {
      stop();
      if (document.activeElement === edge) panel.querySelector<HTMLElement>("#drawerClose")?.focus({ preventScroll: true });
    }
  };
  const change = (next: number): void => {
    preferred = Math.max(MIN_WIDTH, Math.min(Math.round(next), maximum()));
    refresh();
    try { localStorage.setItem(DETAILS_WIDTH_KEY, String(preferred)); } catch { /* Keep the in-memory width. */ }
  };
  const stop = (): void => {
    const pointer = drag?.id;
    drag = undefined;
    panel.classList.remove("resizing");
    if (pointer !== undefined && edge.hasPointerCapture(pointer)) edge.releasePointerCapture(pointer);
  };
  edge.addEventListener("pointerdown", event => {
    if (event.button !== 0 || drag || window.innerWidth < NARROW_WIDTH) return;
    event.preventDefault();
    edge.focus({ preventScroll: true });
    drag = { id: event.pointerId, x: event.clientX, width: width() };
    edge.setPointerCapture(event.pointerId);
    panel.classList.add("resizing");
  });
  edge.addEventListener("pointermove", event => {
    if (drag?.id === event.pointerId) change(drag.width + drag.x - event.clientX);
  });
  for (const type of ["pointerup", "pointercancel", "lostpointercapture"] as const) {
    edge.addEventListener(type, event => { if (drag?.id === event.pointerId) stop(); });
  }
  edge.addEventListener("keydown", event => {
    if (window.innerWidth < NARROW_WIDTH) return;
    const step = event.shiftKey ? 50 : 10;
    const next = event.key === "ArrowLeft" ? width() + step : event.key === "ArrowRight" ? width() - step
      : event.key === "Home" ? MIN_WIDTH : event.key === "End" ? maximum() : undefined;
    if (next === undefined) return;
    event.preventDefault();
    change(next);
  });
  refresh();
  window.addEventListener("resize", refresh);
  return { refresh, stop };
}
