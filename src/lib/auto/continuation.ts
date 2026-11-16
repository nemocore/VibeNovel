/**
 * Joins a cut-off reply with its continuation without duplicating text or
 * fusing two sentences. A model that resumes mid-word needs no separator; one
 * that resumes after punctuation or a capital needs a space.
 */
export function joinContinuation(previous: string, addition: string): string {
  const left = previous.trimEnd();
  const right = addition.trimStart();
  if (!left) return right;
  if (!right) return previous;
  const lastChar = left.slice(-1);
  const firstChar = right.slice(0, 1);
  if (/\n/.test(previous.slice(left.length))) return `${left}\n${right}`;
  if (/\s/.test(lastChar)) return `${left}${right}`;
  if (/[.,;:!?)\]}"'…]/.test(lastChar)) return `${left} ${right}`;
  if (/[A-Z0-9]/.test(firstChar)) return `${left} ${right}`;
  return `${left}${right}`;
}
