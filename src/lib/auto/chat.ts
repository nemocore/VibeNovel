/**
 * Auto Mode planning chat lives in the same `chats` table as Studio chats,
 * under its own scope so the two workspaces never collide.
 */
export const AUTO_PLAN_CHAT_SCOPE = "auto_plan";
