/**
 * Models wrap JSON in fences and add commentary. This finds the outermost
 * balanced object or array and parses the first candidate that works.
 */
export function extractJson(raw: string): unknown {
  const withoutFences = raw.replace(/```json/gi, "```").replace(/```/g, " ");
  const candidates = collectCandidates(withoutFences);
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // Try the next balanced block.
    }
  }
  throw new Error("No valid JSON object found in the reply.");
}

function collectCandidates(text: string): string[] {
  const candidates: string[] = [];
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char !== "{" && char !== "[") continue;
    const block = readBalanced(text, index);
    if (block) {
      candidates.push(block);
      index += block.length - 1;
    }
  }
  if (!candidates.length) candidates.push(text.trim());
  return candidates;
}

function readBalanced(text: string, start: number): string | null {
  const open = text[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === open) depth += 1;
    else if (char === close) {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }
  return null;
}