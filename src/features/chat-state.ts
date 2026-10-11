export const CHAT_REACTIONS = ['❤️', '👍', '😂', '🎉', '🙏'] as const;
export type ChatReactionEmoji = typeof CHAT_REACTIONS[number];
export type ChatReaction = { uid: string; emoji: ChatReactionEmoji };

export function isChatReaction(value: unknown): value is ChatReactionEmoji {
  return typeof value === 'string' && CHAT_REACTIONS.includes(value as ChatReactionEmoji);
}

export function chatUnreadCounts(messages: readonly { id: string; uid: string; channel: string; createdAt?: Date }[], uid: string, readAt: Readonly<Record<string, number>>): Record<string, number> {
  const counts: Record<string, number> = {};
  const seen = new Set<string>();
  for (const message of messages) {
    if (seen.has(message.id) || message.uid === uid || !message.createdAt) continue;
    seen.add(message.id);
    if (message.createdAt.getTime() > (readAt[message.channel] ?? 0)) counts[message.channel] = (counts[message.channel] ?? 0) + 1;
  }
  return counts;
}

export function groupedChatReactions(reactions: readonly ChatReaction[]): Array<{ emoji: ChatReactionEmoji; uids: string[] }> {
  return CHAT_REACTIONS.map(emoji => ({ emoji, uids: [...new Set(reactions.filter(reaction => reaction.emoji === emoji).map(reaction => reaction.uid))] })).filter(group => group.uids.length > 0);
}

export function sameChatDay(first?: Date, second?: Date): boolean {
  return Boolean(first && second && first.getFullYear() === second.getFullYear()
    && first.getMonth() === second.getMonth() && first.getDate() === second.getDate());
}
