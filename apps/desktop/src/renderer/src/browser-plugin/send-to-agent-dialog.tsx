import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@multica/core/api";
import { DRAFT_NEW_SESSION, useChatStore } from "@multica/core/chat";
import { useWorkspaceId } from "@multica/core/hooks";
import { paths, useWorkspaceSlug } from "@multica/core/paths";
import { searchIssues } from "@multica/core/search-index";
import {
  Command,
  CommandDialog,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@multica/ui/components/ui/command";
import { useNavigation } from "@multica/views/navigation";
import { useBrowserT } from "./i18n";
import {
  chatDraftTarget,
  deliverBrowserPayload,
  issueCommentDraftTarget,
  type DraftTarget,
} from "./send-to-agent";
import { useBrowserSendStore } from "./send-to-agent-store";

const SEARCH_DEBOUNCE_MS = 250;

export function SendToAgentDialog() {
  const hasPending = useBrowserSendStore((s) => s.pending !== null);
  // The body unmounts with the pending payload, so the query never leaks into the next send.
  return hasPending ? <SendToAgentMenu /> : null;
}

function SendToAgentMenu() {
  const t = useBrowserT();
  const slug = useWorkspaceSlug();
  const wsId = useWorkspaceId();
  const { push } = useNavigation();
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  const searching = query.trim() !== "";
  const { data, isFetching } = useQuery({
    queryKey: ["browser-plugin", "send-to-agent", "issues", wsId, debounced],
    queryFn: () => searchIssues({ q: debounced, limit: 20 }),
    enabled: debounced !== "",
  });
  const issues = debounced === "" ? [] : (data?.issues ?? []);
  const settled = searching && debounced === query.trim() && !isFetching;

  // Take ownership before the first await so a late dismiss cannot cancel an in-flight send.
  const deliver = async (target: DraftTarget, destination: string | null) => {
    const pending = useBrowserSendStore.getState().take();
    if (!pending) return;
    const hasImages = pending.payload.images.length > 0;
    const toastId = hasImages
      ? toast.loading(t("multica.browser.send.sending_toast", "Uploading screenshots..."))
      : undefined;
    try {
      const { failed } = await deliverBrowserPayload(pending.payload, target, { api });
      if (failed > 0) {
        toast.error(
          t(
            "multica.browser.send.upload_failed_toast",
            "Some screenshots failed to upload. The text was kept in the draft.",
          ),
        );
        pending.reject(new Error("Some screenshots failed to upload"));
      } else {
        pending.resolve();
      }
    } catch (error) {
      pending.reject(error instanceof Error ? error : new Error(String(error)));
    } finally {
      if (toastId !== undefined) toast.dismiss(toastId);
    }
    if (destination) push(destination);
  };

  const sendToIssue = (issueId: string) => {
    if (!slug) return;
    return deliver(issueCommentDraftTarget(issueId), paths.workspace(slug).issueDetail(issueId));
  };

  const sendToChat = () => {
    const chat = useChatStore.getState();
    const { activeSessionId } = chat;
    // Close the chat window first so its input is not mounted while uploads write the draft.
    chat.setOpen(false);
    const sessionId = activeSessionId ?? DRAFT_NEW_SESSION;
    if (!slug) return;
    const destination = activeSessionId
      ? paths.workspace(slug).chatSession(activeSessionId)
      : paths.workspace(slug).chat();
    return deliver(chatDraftTarget(sessionId), destination);
  };

  return (
    <CommandDialog
      open
      onOpenChange={(open) => {
        if (!open) useBrowserSendStore.getState().cancel();
      }}
      title={t("multica.browser.send.dialog_title", "Send to")}
      description={t("multica.browser.send.dialog_title", "Send to")}
    >
      <Command shouldFilter={false}>
        <CommandInput
          placeholder={t("multica.browser.send.search_placeholder", "Search issues...")}
          value={query}
          onValueChange={setQuery}
        />
        <CommandList>
          <CommandGroup heading={t("multica.browser.send.chat_group", "Chat")}>
            <CommandItem value="chat" onSelect={() => void sendToChat()}>
              {t("multica.browser.send.chat_item", "Chat input")}
            </CommandItem>
          </CommandGroup>
          {searching && (
            <CommandGroup heading={t("multica.browser.send.issues_group", "Issue comment draft")}>
              {issues.map((issue) => (
                <CommandItem
                  key={issue.id}
                  value={issue.id}
                  onSelect={() => void sendToIssue(issue.id)}
                >
                  <span className="shrink-0 text-muted-foreground">{issue.identifier}</span>
                  <span className="truncate">{issue.title}</span>
                </CommandItem>
              ))}
              {settled && issues.length === 0 && (
                <div className="py-6 text-center text-body text-muted-foreground">
                  {t("multica.browser.send.no_results", "No issues found")}
                </div>
              )}
            </CommandGroup>
          )}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
