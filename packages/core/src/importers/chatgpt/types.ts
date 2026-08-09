export interface ProviderMessage {
  id?: unknown;
  author?: unknown;
  create_time?: unknown;
  content?: unknown;
  metadata?: unknown;
  [key: string]: unknown;
}

export interface ProviderNode {
  id?: unknown;
  parent?: unknown;
  children?: unknown;
  message?: ProviderMessage | null;
  [key: string]: unknown;
}

export interface ProviderConversation {
  id?: unknown;
  conversation_id?: unknown;
  title?: unknown;
  create_time?: unknown;
  update_time?: unknown;
  current_node?: unknown;
  mapping?: unknown;
  [key: string]: unknown;
}
