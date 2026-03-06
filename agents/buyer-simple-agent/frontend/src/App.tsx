import { useState, useEffect, useCallback } from "react";
import {
  fetchSellers,
  fetchBalance,
  streamChat,
  connectLogStream,
  shopGroceryList,
  loadHistory,
  saveHistory,
  submitReview,
  type Seller,
  type LogEntry,
  type ChatMessage,
  type GroceryItem,
  type HistoryEntry,
} from "./api";
import ChatFab from "./components/ChatFab";
import SellerSidebar from "./components/SellerSidebar";
import ShoppingListModule from "./components/ShoppingListModule";
import ActivityLog from "./components/ActivityLog";
import GroceryUpload from "./components/GroceryUpload";
import ShoppingProgress, {
  type ShoppingItem,
} from "./components/ShoppingProgress";
import ShoppingHistory from "./components/ShoppingHistory";

const MAX_LOGS = 200;

export default function App() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sellers, setSellers] = useState<Seller[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [currentTool, setCurrentTool] = useState("");
  const [_balance, setBalance] = useState<Record<string, unknown> | null>(null);

  // Grocery state
  const [currentShoppingList, setCurrentShoppingList] = useState<GroceryItem[]>([]);
  const [shoppingItems, setShoppingItems] = useState<ShoppingItem[]>([]);
  const [isShopping, setIsShopping] = useState(false);
  const [shoppingSummary, setShoppingSummary] = useState<{
    purchased: number;
    skipped: number;
    failed: number;
    total_credits: number;
    seller_name?: string;
    seller_url?: string;
    results?: Array<{
      item: { name: string; quantity: number; unit: string; raw_line: string };
      status: string;
      credits?: number;
      error?: string;
    }>;
  } | null>(null);
  const [parseError, setParseError] = useState("");
  const [shoppingHistory, setShoppingHistory] = useState<HistoryEntry[]>(() =>
    loadHistory(),
  );
  const [lastCompletedEntryId, setLastCompletedEntryId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"shopping" | "history">("shopping");

  useEffect(() => {
    const load = () => {
      fetchSellers().then(setSellers).catch(() => {});
    };
    load();
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    fetchBalance().then((data) => {
      if (data) setBalance(data);
    });
  }, []);

  useEffect(() => {
    const disconnect = connectLogStream((entry) => {
      setLogs((prev) => {
        const last = prev[prev.length - 1];
        if (
          last &&
          last.timestamp === entry.timestamp &&
          last.action === entry.action &&
          last.message === entry.message
        ) {
          return prev;
        }
        const next = [...prev, entry];
        return next.length > MAX_LOGS ? next.slice(-MAX_LOGS) : next;
      });
    });
    return disconnect;
  }, []);

  const handleHistoryChange = useCallback((entries: HistoryEntry[]) => {
    setShoppingHistory(entries);
    saveHistory(entries);
  }, []);

  // --- Chat handler ---
  const handleSend = useCallback(async (message: string) => {
    setMessages((prev) => [...prev, { role: "user", text: message }]);
    setIsStreaming(true);
    setStreamingText("");
    setCurrentTool("");
    let lastToolUsed = "";

    await streamChat(message, {
      onToken: (text) => setStreamingText((prev) => prev + text),
      onToolUse: (name) => {
        setCurrentTool(name);
        lastToolUsed = name;
      },
      onDone: (fullText) => {
        setMessages((prev) => [
          ...prev,
          { role: "agent", text: fullText, toolUse: lastToolUsed || undefined },
        ]);
        setIsStreaming(false);
        setStreamingText("");
        setCurrentTool("");
        fetchSellers().then(setSellers).catch(() => {});
        fetchBalance().then((data) => {
          if (data) setBalance(data);
        });
      },
      onError: (error) => {
        setMessages((prev) => [...prev, { role: "agent", text: `Error: ${error}` }]);
        setIsStreaming(false);
        setStreamingText("");
        setCurrentTool("");
      },
    });
  }, []);

  // --- Grocery handlers ---
  const handleItemsParsed = useCallback(async (items: GroceryItem[]) => {
    setParseError("");
    setCurrentShoppingList(items);
    const shopItems: ShoppingItem[] = items.map((item) => ({
      item,
      status: "pending" as const,
    }));
    setShoppingItems(shopItems);
    setShoppingSummary(null);
    setLastCompletedEntryId(null);
    setIsShopping(true);

    await shopGroceryList(items, {
      onItemStart: (index) => {
        setShoppingItems((prev) =>
          prev.map((si, i) => (i === index ? { ...si, status: "purchasing" } : si)),
        );
      },
      onItemDone: (index, _item, status, credits, error) => {
        setShoppingItems((prev) =>
          prev.map((si, i) =>
            i === index
              ? { ...si, status: status as ShoppingItem["status"], credits, error }
              : si,
          ),
        );
      },
      onDone: (summary) => {
        setIsShopping(false);
        setShoppingSummary(summary);
        fetchBalance().then((data) => {
          if (data) setBalance(data);
        });

        const itemsFromResults =
          summary.results?.map((r) => ({
            item: r.item,
            status: r.status as ShoppingItem["status"],
            credits: r.credits,
            error: r.error,
          })) ?? shopItems;

        const entry: HistoryEntry = {
          id: crypto.randomUUID(),
          timestamp: new Date().toISOString(),
          sellerName: summary.seller_name ?? "Grocery Seller",
          sellerUrl: summary.seller_url ?? "",
          items: itemsFromResults,
          summary: {
            purchased: summary.purchased,
            skipped: summary.skipped,
            failed: summary.failed,
            total_credits: summary.total_credits,
          },
          rating: null,
          review: "",
        };
        setShoppingHistory((prev) => {
          const next = [...prev, entry];
          saveHistory(next);
          return next;
        });
        setLastCompletedEntryId(entry.id);
      },
      onError: (msg) => {
        setIsShopping(false);
        setParseError(msg);
      },
    });
  }, []);

  const handleGroceryReset = useCallback(() => {
    setCurrentShoppingList([]);
    setShoppingItems([]);
    setShoppingSummary(null);
    setParseError("");
    setLastCompletedEntryId(null);
  }, []);

  const handleRateSubmit = useCallback(
    async (rating: number, review: string) => {
      if (!shoppingSummary?.seller_url || !lastCompletedEntryId) return;
      try {
        await submitReview(
          shoppingSummary.seller_url,
          shoppingSummary.seller_name ?? "Grocery Seller",
          rating,
          review,
        );
        setShoppingHistory((prev) => {
          const next = prev.map((e) =>
            e.id === lastCompletedEntryId ? { ...e, rating, review } : e,
          );
          saveHistory(next);
          return next;
        });
      } catch {
        // ignore
      }
    },
    [shoppingSummary, lastCompletedEntryId],
  );

  const hasList = currentShoppingList.length > 0;

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      {/* Top bar with New List button */}
      <div className="flex items-center justify-between border-b px-4 py-2 shrink-0 bg-card">
        <h1 className="text-lg font-semibold">Shop Mate</h1>
        <button
          type="button"
          onClick={handleGroceryReset}
          disabled={isShopping}
          className="px-4 py-1.5 rounded-lg text-sm font-medium bg-gradient-to-r from-[var(--color-nvm-teal)] to-[var(--color-nvm-lime)] text-white shadow-sm hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
        >
          + New List
        </button>
      </div>

      {/* Main content: Sellers | Grocery area */}
      <div className="flex flex-1 min-h-0">
        {/* Seller sidebar */}
        <div className="w-[240px] shrink-0">
          <SellerSidebar sellers={sellers} />
        </div>

        {/* Main panel: Tab bar + content */}
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
          {/* Tab bar */}
          <div className="flex shrink-0 border-b bg-muted/30">
            <button
              type="button"
              onClick={() => setActiveTab("shopping")}
              className={`px-4 py-2.5 text-sm font-medium transition-colors ${
                activeTab === "shopping"
                  ? "border-b-2 border-[var(--color-nvm-teal)] text-foreground bg-background"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Shopping
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("history")}
              className={`px-4 py-2.5 text-sm font-medium transition-colors ${
                activeTab === "history"
                  ? "border-b-2 border-[var(--color-nvm-teal)] text-foreground bg-background"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              History
            </button>
          </div>

          <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
            {activeTab === "shopping" && (
              <div className="flex-1 overflow-auto p-6 space-y-6">
                {!hasList && (
                  <GroceryUpload
                    onItemsParsed={handleItemsParsed}
                    onParseError={setParseError}
                    disabled={isShopping}
                  />
                )}
                {hasList && (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <ShoppingListModule items={currentShoppingList} />
                    <ShoppingProgress
                      items={shoppingItems}
                      summary={shoppingSummary}
                      isShopping={isShopping}
                      onRateSubmit={handleRateSubmit}
                    />
                  </div>
                )}
                {parseError && (
                  <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                    {parseError}
                  </div>
                )}
              </div>
            )}
            {activeTab === "history" && (
              <div className="flex-1 overflow-auto p-6">
                <ShoppingHistory
                  entries={shoppingHistory}
                  onEntriesChange={handleHistoryChange}
                  fullHeight
                />
              </div>
            )}
          </div>

          <div className="h-[180px] shrink-0 border-t">
            <ActivityLog logs={logs} />
          </div>
        </div>
      </div>

      {/* Chat FAB - floating bottom-right */}
      <ChatFab
        messages={messages}
        isStreaming={isStreaming}
        streamingText={streamingText}
        currentTool={currentTool}
        onSend={handleSend}
      />
    </div>
  );
}
