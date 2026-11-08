import { glyphs } from "./icon-paths.js";

// Preserve each glyph's native viewBox when sizing it in the interface.
export function icon(name) {
  const glyph = glyphs[name];
  if (glyph) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${glyph.viewBox}" width="24" height="24" fill="none" stroke="none" aria-hidden="true" focusable="false" data-glyph="${name}">${glyph.paths}</svg>`;
  }
  if (name === "refresh") {
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="currentColor" stroke="none" aria-hidden="true" focusable="false" data-glyph="refresh"><path d="M17.65 6.35A7.95 7.95 0 0 0 12 4a8 8 0 1 0 7.45 10.9 1 1 0 0 0-1.86-.73A6 6 0 1 1 16.24 7.76L13 11h8V3z"/></svg>';
  }
  throw new Error(`Unknown interface icon: ${name}`);
}
