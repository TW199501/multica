// @vitest-environment node
import { describe, expect, it } from "vitest";
import { clampDialogOffset, type DialogBounds } from "./clamp-dialog-offset";

// 1000x800 viewport, 600x400 dialog centred: 200px slack left/right, 200px
// above/below; a 40px title bar.
const BOUNDS: DialogBounds = {
  viewportWidth: 1000,
  viewportHeight: 800,
  dialogWidth: 600,
  dialogHeight: 400,
  titleBarHeight: 40,
};

/** Viewport-space rect of the title bar for a given offset. */
function titleBar(offset: { x: number; y: number }, bounds = BOUNDS) {
  const left = bounds.viewportWidth / 2 + offset.x - bounds.dialogWidth / 2;
  const top = bounds.viewportHeight / 2 + offset.y - bounds.dialogHeight / 2;
  return { left, right: left + bounds.dialogWidth, top, bottom: top + bounds.titleBarHeight };
}

describe("clampDialogOffset", () => {
  it("leaves an offset inside the viewport unchanged", () => {
    expect(clampDialogOffset({ x: 120, y: -150 }, BOUNDS)).toEqual({ x: 120, y: -150 });
  });

  it("stops at the left edge", () => {
    const offset = clampDialogOffset({ x: -5000, y: 0 }, BOUNDS);
    expect(offset.x).toBe(-200);
    expect(titleBar(offset).left).toBe(0);
  });

  it("stops at the right edge, keeping the close button on screen", () => {
    const offset = clampDialogOffset({ x: 5000, y: 0 }, BOUNDS);
    expect(offset.x).toBe(200);
    expect(titleBar(offset).right).toBe(1000);
  });

  it("stops at the top edge", () => {
    const offset = clampDialogOffset({ x: 0, y: -5000 }, BOUNDS);
    expect(offset.y).toBe(-200);
    expect(titleBar(offset).top).toBe(0);
  });

  it("lets the body leave the bottom edge but keeps the title bar on screen", () => {
    const offset = clampDialogOffset({ x: 0, y: 5000 }, BOUNDS);
    expect(offset.y).toBe(560);
    expect(titleBar(offset).bottom).toBe(800);
  });

  it("clamps both axes at a corner", () => {
    const offset = clampDialogOffset({ x: 5000, y: -5000 }, BOUNDS);
    expect(titleBar(offset)).toEqual({ left: 400, right: 1000, top: 0, bottom: 40 });
  });

  it("pins the start edge when the dialog is wider than the viewport", () => {
    const narrow = { ...BOUNDS, viewportWidth: 500 };
    const offset = clampDialogOffset({ x: -300, y: 0 }, narrow);
    expect(titleBar(offset, narrow).left).toBe(0);
  });
});
