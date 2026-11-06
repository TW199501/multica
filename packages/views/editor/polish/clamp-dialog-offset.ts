export interface DialogOffset {
  x: number;
  y: number;
}

export interface DialogBounds {
  viewportWidth: number;
  viewportHeight: number;
  dialogWidth: number;
  dialogHeight: number;
  /** Height of the title bar at the top of the dialog. */
  titleBarHeight: number;
}

function clamp(value: number, min: number, max: number): number {
  // A dialog wider or taller than the viewport cannot satisfy both edges;
  // keep its start edge visible, which holds the title text.
  if (min > max) return min;
  return Math.min(Math.max(value, min), max);
}

/**
 * Limits the drag offset of a dialog centred in the viewport so that its whole
 * title bar, which spans the dialog's full width and carries the close button,
 * stays inside the viewport.
 */
export function clampDialogOffset(offset: DialogOffset, bounds: DialogBounds): DialogOffset {
  const { viewportWidth, viewportHeight, dialogWidth, dialogHeight, titleBarHeight } = bounds;
  const halfSlackX = (viewportWidth - dialogWidth) / 2;
  const halfSlackY = (viewportHeight - dialogHeight) / 2;
  return {
    x: clamp(offset.x, -halfSlackX, halfSlackX),
    // Top edge at the viewport top at the least; the title bar's bottom edge at
    // the viewport bottom at the most. The body below may leave the screen.
    y: clamp(offset.y, -halfSlackY, halfSlackY + dialogHeight - titleBarHeight),
  };
}
