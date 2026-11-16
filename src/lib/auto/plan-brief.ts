type PlanMessage = { role: "user" | "assistant"; content: string };

/**
 * The locked blueprint comes from the final assistant reply only. Earlier
 * turns contain rejected ideas and critiques, and mixing them in pollutes the
 * Story Architect input.
 */
export function finalPlanText(messages: PlanMessage[], premise: string): string {
  const finalAssistant = [...messages]
    .reverse()
    .find((message) => message.role === "assistant" && message.content.trim());
  return finalAssistant?.content.trim() || premise.trim();
}