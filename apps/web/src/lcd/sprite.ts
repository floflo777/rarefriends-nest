/** 16x16 pet frames: conversion between `PetFrame.bits` (bigint, bit y*16+x) and row strings. */
import type { PetFrame } from "@nest/core";

export const FRAME_SIZE = 16;

/** Rows of '#' (on) and any other char (off), 16 rows of 16. */
export function frameFromRows(rows: readonly string[]): PetFrame {
  let bits = 0n;
  for (let y = 0; y < FRAME_SIZE; y++) {
    const row = rows[y] ?? "";
    for (let x = 0; x < FRAME_SIZE; x++) {
      if (row[x] === "#") bits |= 1n << BigInt(y * FRAME_SIZE + x);
    }
  }
  return { bits };
}

export function framePixel(frame: PetFrame, x: number, y: number): boolean {
  return ((frame.bits >> BigInt(y * FRAME_SIZE + x)) & 1n) === 1n;
}

/** Mirror horizontally (used to fake a second idle pose when only one frame is known). */
export function mirrorFrame(frame: PetFrame): PetFrame {
  let bits = 0n;
  for (let y = 0; y < FRAME_SIZE; y++) {
    for (let x = 0; x < FRAME_SIZE; x++) {
      if (framePixel(frame, x, y)) bits |= 1n << BigInt(y * FRAME_SIZE + (FRAME_SIZE - 1 - x));
    }
  }
  return { bits };
}
