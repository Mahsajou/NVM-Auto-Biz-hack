import { useRef, useEffect, useState } from "react";
import { Send, MessageCircle, Wrench } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import type { ChatMessage } from "@/api";

interface ChatFabProps {
  messages: ChatMessage[];
  isStreaming: boolean;
  streamingText: string;
  currentTool: string;
  onSend: (message: string) => void;
}

export default function ChatFab({
  messages,
  isStreaming,
  streamingText,
  currentTool,
  onSend,
}: ChatFabProps) {
  const [input, setInput] = useState("");
  const [open, setOpen] = useState(false);
  const [lastSeenCount, setLastSeenCount] = useState(0);
  const bottomRef = useRef<HTMLDivElement>(null);

  const unreadCount = open ? 0 : Math.max(0, messages.length - lastSeenCount);

  useEffect(() => {
    if (open) {
      setLastSeenCount(messages.length);
    }
  }, [open, messages.length]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, streamingText]);

  const handleSubmit = () => {
    const trimmed = input.trim();
    if (!trimmed || isStreaming) return;
    onSend(trimmed);
    setInput("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <>
      {/* Popover - appears above the FAB */}
      {open && (
        <div
          className="fixed bottom-20 right-4 z-50 w-[350px] h-[450px] flex flex-col rounded-xl border bg-card shadow-lg overflow-hidden"
          style={{ maxHeight: "calc(100vh - 6rem)" }}
        >
          <div className="flex items-center gap-2 px-3 py-2 border-b shrink-0 bg-muted/30">
            <MessageCircle className="h-4 w-4 text-[var(--color-nvm-teal)]" />
            <span className="text-sm font-medium">Chat</span>
          </div>

          <ScrollArea className="flex-1 min-h-0">
            <div className="p-3 space-y-2">
              {messages.length === 0 && !isStreaming && (
                <p className="text-xs text-muted-foreground px-1">
                  Ask about balance, sellers, or purchases.
                </p>
              )}
              {messages.map((msg, i) => (
                <div
                  key={i}
                  className={`rounded-lg px-2 py-1.5 text-xs ${
                    msg.role === "user"
                      ? "bg-[var(--color-nvm-teal)]/10 ml-4"
                      : "bg-muted/50 mr-4"
                  }`}
                >
                  {msg.toolUse && (
                    <div className="flex items-center gap-1 mb-0.5 text-[10px] text-muted-foreground">
                      <Wrench className="h-2.5 w-2.5" />
                      {msg.toolUse}
                    </div>
                  )}
                  <span className="break-words">{msg.text}</span>
                </div>
              ))}
              {isStreaming && (
                <div className="rounded-lg px-2 py-1.5 text-xs bg-muted/50 mr-4">
                  {currentTool && (
                    <div className="flex items-center gap-1 mb-0.5 text-[10px] text-muted-foreground">
                      <Wrench className="h-2.5 w-2.5 animate-spin" />
                      {currentTool}
                    </div>
                  )}
                  <span>{streamingText || "..."}</span>
                  <span className="inline-block w-1.5 h-3 bg-primary/60 ml-0.5 animate-blink" />
                </div>
              )}
              <div ref={bottomRef} />
            </div>
          </ScrollArea>

          <div className="border-t p-2 shrink-0">
            <div className="flex gap-2">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask agent..."
                className="flex-1 min-w-0 rounded border bg-background px-2 py-1.5 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8 shrink-0"
                onClick={handleSubmit}
                disabled={!input.trim() || isStreaming}
              >
                <Send className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* FAB - fixed bottom-right */}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="fixed bottom-4 right-4 z-50 flex items-center justify-center w-14 h-14 rounded-full bg-gradient-to-r from-[var(--color-nvm-teal)] to-[var(--color-nvm-lime)] text-white shadow-lg hover:opacity-90 transition-opacity focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        aria-label={open ? "Close chat" : "Open chat"}
      >
        <MessageCircle className="h-6 w-6" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex items-center justify-center min-w-[18px] h-[18px] rounded-full bg-red-500 text-[10px] font-bold text-white">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>
    </>
  );
}
