import type { Organism } from "./types";

/**
 * Uniform-grid spatial hash for neighbour queries. Rebuilt each tick.
 * Avoids O(n^2) perception scans. Reuses arrays to limit allocation.
 */
export class SpatialHash {
  private cellSize: number;
  private cols: number;
  private rows: number;
  private cells: number[][]; // index -> list of organism array-indices
  width: number;
  height: number;

  constructor(width: number, height: number, cellSize: number) {
    this.width = width;
    this.height = height;
    this.cellSize = cellSize;
    this.cols = Math.max(1, Math.ceil(width / cellSize));
    this.rows = Math.max(1, Math.ceil(height / cellSize));
    this.cells = new Array(this.cols * this.rows);
    for (let i = 0; i < this.cells.length; i++) this.cells[i] = [];
  }

  clear(): void {
    for (let i = 0; i < this.cells.length; i++) this.cells[i].length = 0;
  }

  private cellIndex(x: number, y: number): number {
    let cx = Math.floor(x / this.cellSize);
    let cy = Math.floor(y / this.cellSize);
    if (cx < 0) cx = 0;
    else if (cx >= this.cols) cx = this.cols - 1;
    if (cy < 0) cy = 0;
    else if (cy >= this.rows) cy = this.rows - 1;
    return cy * this.cols + cx;
  }

  insert(index: number, x: number, y: number): void {
    this.cells[this.cellIndex(x, y)].push(index);
  }

  /**
   * Invoke cb for every organism index whose cell overlaps a radius query.
   * Callers do the exact distance check.
   */
  queryRadius(x: number, y: number, radius: number, cb: (index: number) => void): void {
    const minCx = Math.max(0, Math.floor((x - radius) / this.cellSize));
    const maxCx = Math.min(this.cols - 1, Math.floor((x + radius) / this.cellSize));
    const minCy = Math.max(0, Math.floor((y - radius) / this.cellSize));
    const maxCy = Math.min(this.rows - 1, Math.floor((y + radius) / this.cellSize));
    for (let cy = minCy; cy <= maxCy; cy++) {
      for (let cx = minCx; cx <= maxCx; cx++) {
        const cell = this.cells[cy * this.cols + cx];
        for (let i = 0; i < cell.length; i++) cb(cell[i]);
      }
    }
  }
}

export function rebuild(hash: SpatialHash, organisms: Organism[]): void {
  hash.clear();
  for (let i = 0; i < organisms.length; i++) {
    const o = organisms[i];
    if (o.alive) hash.insert(i, o.pos.x, o.pos.y);
  }
}
