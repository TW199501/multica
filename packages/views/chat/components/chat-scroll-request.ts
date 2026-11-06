/** Marks the scroll container of a chat message list. */
export const CHAT_MESSAGE_LIST_ATTR = "data-chat-message-list";
/** Dispatched on that container to pin its newest message. */
export const CHAT_SCROLL_TO_LATEST_EVENT = "multica:chat-scroll-to-latest";

/**
 * Asks the message list of the conversation `from` sits in to scroll to its
 * newest message: the nearest enclosing surface that holds a marked list.
 */
export function requestChatScrollToLatest(from: HTMLElement | null): void {
  let node = from?.parentElement ?? null;
  while (node) {
    const list = node.querySelector(`[${CHAT_MESSAGE_LIST_ATTR}]`);
    if (list) {
      list.dispatchEvent(new CustomEvent(CHAT_SCROLL_TO_LATEST_EVENT));
      return;
    }
    node = node.parentElement;
  }
}
