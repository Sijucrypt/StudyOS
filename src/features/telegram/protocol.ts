import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";

const safeId = z.number().int().min(1).max(4_503_599_627_370_495);
const updateSchema = z.object({
  update_id: z.number().int().min(0).max(4_503_599_627_370_495),
  message: z.object({
    text: z.string().max(200),
    from: z.object({ id: safeId, is_bot: z.literal(false) }),
    chat: z.object({ id: safeId, type: z.literal("private") }),
  }),
});

export function hashLinkToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function matchesWebhookSecret(candidate: string | null, expected: string) {
  if (!candidate || candidate.length > 256) return false;
  return timingSafeEqual(
    createHash("sha256").update(candidate).digest(),
    createHash("sha256").update(expected).digest(),
  );
}

export function readTelegramCommand(value: unknown, username: string) {
  const parsed = updateSchema.safeParse(value);
  if (!parsed.success) return null;
  const { update_id, message } = parsed.data;
  if (message.from.id !== message.chat.id) return null;
  const match = /^\/(start|stop)(?:@([a-zA-Z0-9_]+))?(?: +([A-Za-z0-9_-]{32}))?$/.exec(message.text.trim());
  if (!match || (match[2] && match[2].toLowerCase() !== username.toLowerCase())) return null;
  const [, command, , token] = match;
  if ((command === "start") !== Boolean(token)) return null;
  return {
    incoming_id: update_id,
    command,
    incoming_chat: message.chat.id,
    token_digest: token ? hashLinkToken(token) : null,
  };
}
