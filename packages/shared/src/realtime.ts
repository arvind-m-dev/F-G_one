/** Socket.IO event names shared by server and client. */
export const RT = {
  MESSAGE_NEW: 'message:new',
  MESSAGE_UPDATED: 'message:updated',
  MESSAGE_DELETED: 'message:deleted',
  REACTION_UPDATED: 'reaction:updated',
  CHANNEL_UPDATED: 'channel:updated',
  CHANNEL_REMOVED: 'channel:removed',
  TYPING: 'typing',
  PRESENCE_UPDATED: 'presence:updated',
  ONLINE_SNAPSHOT: 'presence:online',
  NOTIFICATION_NEW: 'notification:new',
  ATTENDANCE_CHANGED: 'attendance:changed',
  ANNOUNCEMENTS_CHANGED: 'announcements:changed',
} as const;

export interface TypingEvent {
  channelId: string;
  userId: string;
  name: string;
  typing: boolean;
}

export interface PresenceEvent {
  userId: string;
  online?: boolean;
  presence?: string;
  statusEmoji?: string | null;
  statusText?: string | null;
  statusExpiresAt?: string | null;
}
