// Fractional ordering: a new position between neighbours, so no other rows need renumbering.
export function positionBetween(prev?: number, next?: number) {
  if (prev === undefined && next === undefined) return 1000;
  if (prev === undefined) return next! - 1000;
  if (next === undefined) return prev + 1000;
  return (prev + next) / 2;
}
