// Sudoku engine: generation, uniqueness checking, and difficulty presets.
// Grid is a flat array of 81 numbers (0 = empty). Index = row * 9 + col (0-based).

export const DIFFICULTIES = {
  easy: { label: "Easy", clues: 45, points: 5 },
  medium: { label: "Medium", clues: 36, points: 10 },
  hard: { label: "Hard", clues: 30, points: 15 },
};

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function canPlace(grid, idx, num) {
  const row = Math.floor(idx / 9);
  const col = idx % 9;
  for (let c = 0; c < 9; c++) if (grid[row * 9 + c] === num) return false;
  for (let r = 0; r < 9; r++) if (grid[r * 9 + col] === num) return false;
  const br = Math.floor(row / 3) * 3;
  const bc = Math.floor(col / 3) * 3;
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      if (grid[(br + r) * 9 + (bc + c)] === num) return false;
    }
  }
  return true;
}

function fillGrid(grid) {
  const idx = grid.indexOf(0);
  if (idx === -1) return true;
  const nums = shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  for (const n of nums) {
    if (canPlace(grid, idx, n)) {
      grid[idx] = n;
      if (fillGrid(grid)) return true;
      grid[idx] = 0;
    }
  }
  return false;
}

// Counts solutions but stops early once `limit` is reached (we only care whether
// the puzzle has exactly one solution).
function countSolutions(grid, limit = 2) {
  const idx = grid.indexOf(0);
  if (idx === -1) return 1;
  let count = 0;
  for (let n = 1; n <= 9; n++) {
    if (canPlace(grid, idx, n)) {
      grid[idx] = n;
      count += countSolutions(grid, limit);
      grid[idx] = 0;
      if (count >= limit) break;
    }
  }
  return count;
}

export function generatePuzzle(difficulty = "medium") {
  const conf = DIFFICULTIES[difficulty] || DIFFICULTIES.medium;

  const solution = new Array(81).fill(0);
  fillGrid(solution);

  const puzzle = solution.slice();
  const target = 81 - conf.clues; // number of cells to remove
  let removed = 0;

  for (const idx of shuffle([...Array(81).keys()])) {
    if (removed >= target) break;
    if (puzzle[idx] === 0) continue;
    const backup = puzzle[idx];
    puzzle[idx] = 0;
    // Only keep the removal if the puzzle still has a single unique solution.
    if (countSolutions(puzzle.slice(), 2) !== 1) {
      puzzle[idx] = backup;
    } else {
      removed++;
    }
  }

  return {
    puzzle,
    solution,
    given: puzzle.map((v) => v !== 0),
    difficulty,
    points: conf.points,
  };
}
