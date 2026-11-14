// Where each participant sits on the projection: 1 centered, 2-3 in a row, 4-9 a 3x3 grid, 10-16 4x4,
// then cols = ceil(sqrt(n)). The last row is centered. Coordinates 0..1, y down (like the phone screen).

export interface Place { x: number; y: number }

export function gridSize(n: number): { cols: number; rows: number } {
  if (n <= 0) return { cols: 0, rows: 0 };
  if (n === 1) return { cols: 1, rows: 1 };
  if (n <= 3) return { cols: n, rows: 1 };
  if (n <= 9) return { cols: 3, rows: Math.ceil(n / 3) };
  const cols = Math.ceil(Math.sqrt(n));
  return { cols, rows: Math.ceil(n / cols) };
}

/** Places for n participants, in slot order. */
export function layout(n: number): Place[] {
  const { cols, rows } = gridSize(n);
  const places: Place[] = [];
  for (let i = 0; i < n; i++) {
    const row = Math.floor(i / cols);
    const inRow = row === rows - 1 ? n - row * cols : cols; // the last row may be shorter: centered
    const col = i - row * cols;
    places.push({
      x: (col + 0.5 + (cols - inRow) / 2) / cols,
      y: (row + 0.5) / rows,
    });
  }
  return places;
}
