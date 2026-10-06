export type ChatViewport = {
  viewportHeight: number;
  viewportOffsetTop?: number;
  pageTop: number;
  bottomObstruction?: number;
};

/** Measurements are layout-viewport coordinates, also when iOS pans the keyboard. */
export function availableChatHeight({ viewportHeight, viewportOffsetTop = 0, pageTop, bottomObstruction = 0 }: ChatViewport) {
  return Math.max(0, Math.floor(viewportOffsetTop + viewportHeight - Math.max(pageTop, viewportOffsetTop) - bottomObstruction - 8));
}
