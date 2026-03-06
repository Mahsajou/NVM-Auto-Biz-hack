import { useState, useEffect, useCallback } from "react";
import { Shield, Users, Star } from "lucide-react";
import {
  fetchSellers,
  fetchBalance,
  streamChat,
  connectLogStream,
  shopGroceryList,
  loadHistory,
  saveHistory,
  submitReview,
  loadBudget,
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
import AccountPage from "./components/AccountPage";
import CheckAmazonCarryIt from "./components/CheckAmazonCarryIt";
import TrustedSellers from "./components/TrustedSellers";
import ContextTool from "./components/ContextTool";
import GetLeads from "./components/GetLeads";
import BuyReviews from "./components/BuyReviews";

const MAX_LOGS = 200;

export default function App() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sellers, setSellers] = useState<Seller[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [currentTool, setCurrentTool] = useState("");
  const [balanceData, setBalanceData] = useState<{
    credits?: number;
    trustnetCredits?: number;
    spent?: number;
    budget?: Record<string, unknown>;
  } | null>(null);

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
  const [contextSavedAt, setContextSavedAt] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"shopping" | "history" | "account" | "trusted" | "activity" | "context" | "leads" | "reviews">("trusted");
  const [userBudget, setUserBudget] = useState<number>(() => loadBudget());

  useEffect(() => {
    const load = () => {
      fetchSellers().then(setSellers).catch(() => {});
    };
    load();
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const load = () => {
      fetchBalance().then((data) => {
        if (data) {
          const credits = (data.balance as { balance?: number })?.balance;
          const trustnetCredits = (data as { trustnet_balance?: number }).trustnet_balance;
          const spent = (data.budget as { total_spent?: number })?.total_spent ?? 0;
          setBalanceData({
            credits: typeof credits === "number" ? credits : 0,
            trustnetCredits: typeof trustnetCredits === "number" ? trustnetCredits : undefined,
            spent,
            budget: data.budget as Record<string, unknown>,
          });
        }
      });
    };
    load();
    const interval = setInterval(load, 10000);
    return () => clearInterval(interval);
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

  const handleEntryRatingChange = useCallback((entryId: string, rating: number | null) => {
    setShoppingHistory((prev) => {
      const next = prev.map((e) =>
        e.id === entryId ? { ...e, rating } : e,
      );
      saveHistory(next);
      return next;
    });
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
          if (data) {
            const credits = (data.balance as { balance?: number })?.balance;
            const spent = (data.budget as { total_spent?: number })?.total_spent ?? 0;
            setBalanceData({
              credits: typeof credits === "number" ? credits : 0,
              spent,
              budget: data.budget as Record<string, unknown>,
            });
          }
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
          if (data) {
            const credits = (data.balance as { balance?: number })?.balance;
            const spent = (data.budget as { total_spent?: number })?.total_spent ?? 0;
            setBalanceData({
              credits: typeof credits === "number" ? credits : 0,
              spent,
              budget: data.budget as Record<string, unknown>,
            });
          }
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
      onContextSaved: (save) => {
        setContextSavedAt(save.timestamp);
        setTimeout(() => setContextSavedAt(null), 8000);
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

  // Spent from API calls: grocery (shopping history) + budget session (chat, etc.)
  const spentFromHistory = shoppingHistory.reduce((sum, e) => sum + e.summary.total_credits, 0);
  const spentFromApi = balanceData?.spent ?? 0;
  const spent = Math.max(spentFromHistory, spentFromApi);
  const credits = balanceData?.credits ?? null;
  const remaining = userBudget > 0 ? Math.max(0, userBudget - spent) : null;

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      {/* Top bar */}
      <div className="flex items-center justify-between border-b px-4 py-2 shrink-0 bg-card gap-4">
        <h1 className="text-lg font-semibold shrink-0">Shop Mate</h1>
        <div className="flex-1 min-w-0" />
        <div className="flex items-center gap-4 shrink-0">
          <button
            type="button"
            onClick={() => setActiveTab("trusted")}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-muted/50 text-sm font-medium hover:bg-muted transition-colors"
          >
            <Shield className="h-4 w-4 text-[var(--color-nvm-teal)]" />
            Trusted Sellers
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("leads")}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-muted/50 text-sm font-medium hover:bg-muted transition-colors"
          >
            <Users className="h-4 w-4 text-[var(--color-nvm-teal)]" />
            Get Lead
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("reviews")}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-muted/50 text-sm font-medium hover:bg-muted transition-colors"
          >
            <Star className="h-4 w-4 text-[var(--color-nvm-teal)]" />
            Buy Reviews
          </button>
          <div className="flex items-center gap-4 px-3 py-1.5 rounded-lg bg-muted/50 text-sm font-medium">
            <span className="tabular-nums">
              <span className="text-muted-foreground">Balance:</span>{" "}
              {credits != null ? `${credits} cr ($${credits})` : "—"}
            </span>
            {balanceData?.trustnetCredits != null && (
              <span className="tabular-nums">
                <span className="text-muted-foreground">Trust Net:</span>{" "}
                {balanceData.trustnetCredits} cr
              </span>
            )}
            <span className="tabular-nums">
              <span className="text-muted-foreground">Spent:</span>{" "}
              {spent} cr
            </span>
            {userBudget > 0 && (
              <span className="tabular-nums">
                <span className="text-muted-foreground">Limit:</span>{" "}
                ${remaining !== null ? remaining : userBudget} / ${userBudget}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={handleGroceryReset}
            disabled={isShopping}
            className="px-4 py-1.5 rounded-lg text-sm font-medium bg-gradient-to-r from-[var(--color-nvm-teal)] to-[var(--color-nvm-lime)] text-white shadow-sm hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
          >
            + New List
          </button>
        </div>
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
          <div className="flex shrink-0 border-b bg-muted/30 overflow-x-auto min-w-0">
            <button
              type="button"
              onClick={() => setActiveTab("shopping")}
              className={`shrink-0 px-4 py-2.5 text-sm font-medium transition-colors ${
                activeTab === "shopping"
                  ? "border-b-2 border-[var(--color-nvm-teal)] text-foreground bg-background"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Shopping
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("trusted")}
              className={`shrink-0 px-4 py-2.5 text-sm font-medium transition-colors ${
                activeTab === "trusted"
                  ? "border-b-2 border-[var(--color-nvm-teal)] text-foreground bg-background"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Trusted Sellers
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("history")}
              className={`shrink-0 px-4 py-2.5 text-sm font-medium transition-colors ${
                activeTab === "history"
                  ? "border-b-2 border-[var(--color-nvm-teal)] text-foreground bg-background"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              History
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("account")}
              className={`shrink-0 px-4 py-2.5 text-sm font-medium transition-colors ${
                activeTab === "account"
                  ? "border-b-2 border-[var(--color-nvm-teal)] text-foreground bg-background"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Account
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("activity")}
              className={`shrink-0 px-4 py-2.5 text-sm font-medium transition-colors ${
                activeTab === "activity"
                  ? "border-b-2 border-[var(--color-nvm-teal)] text-foreground bg-background"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Activity Log
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("context")}
              className={`shrink-0 px-4 py-2.5 text-sm font-medium transition-colors ${
                activeTab === "context"
                  ? "border-b-2 border-[var(--color-nvm-teal)] text-foreground bg-background"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Context Tool
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("leads")}
              className={`shrink-0 px-4 py-2.5 text-sm font-medium transition-colors ${
                activeTab === "leads"
                  ? "border-b-2 border-[var(--color-nvm-teal)] text-foreground bg-background"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Leads
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("reviews")}
              className={`shrink-0 px-4 py-2.5 text-sm font-medium transition-colors ${
                activeTab === "reviews"
                  ? "border-b-2 border-[var(--color-nvm-teal)] text-foreground bg-background"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Buy Reviews
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
                <CheckAmazonCarryIt
                  shoppingListItems={currentShoppingList}
                  disabled={isShopping}
                />
              </div>
            )}
            {activeTab === "history" && (
              <div className="flex-1 overflow-auto p-6">
                <ShoppingHistory
                  entries={shoppingHistory}
                  onEntriesChange={handleHistoryChange}
                  onRatingChange={handleEntryRatingChange}
                  fullHeight
                />
              </div>
            )}
            {activeTab === "account" && (
              <div className="flex-1 overflow-auto p-6">
                <AccountPage
                  onBudgetChange={setUserBudget}
                />
              </div>
            )}
            {activeTab === "trusted" && (
              <div className="flex-1 min-h-0 overflow-auto p-6 bg-background">
                <TrustedSellers />
              </div>
            )}
            {activeTab === "activity" && (
              <div className="flex-1 min-h-0 overflow-hidden flex flex-col p-4">
                <ActivityLog logs={logs} />
              </div>
            )}
            {activeTab === "context" && (
              <div className="flex-1 min-h-0 overflow-auto">
                <ContextTool lastSavedAt={contextSavedAt} />
              </div>
            )}
            {activeTab === "leads" && (
              <div className="flex-1 overflow-auto p-6">
                <GetLeads />
              </div>
            )}
            {activeTab === "reviews" && (
              <div className="flex-1 overflow-auto p-6">
                <BuyReviews />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Context saved toast - shows when Platon dump succeeds */}
      {contextSavedAt && (
        <div className="fixed bottom-24 right-6 z-50 rounded-lg border border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950/90 px-4 py-2 text-sm text-green-800 dark:text-green-200 shadow-lg">
          Context saved at {new Date(contextSavedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
        </div>
      )}

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
