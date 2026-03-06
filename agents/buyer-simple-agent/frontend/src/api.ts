export interface Seller {
  url: string;
  name: string;
  description: string;
  skills: string[];
  credits: number;
  cost_description: string;
}

export interface LogEntry {
  timestamp: string;
  component: string;
  action: string;
  message: string;
}

export interface ChatMessage {
  role: "user" | "agent";
  text: string;
  toolUse?: string;
}

export async function fetchSellers(): Promise<Seller[]> {
  const res = await fetch("/api/sellers");
  if (!res.ok) return [];
  return res.json();
}

export async function fetchBalance(): Promise<{
  balance: Record<string, unknown>;
  budget: Record<string, unknown>;
} | null> {
  try {
    const res = await fetch("/api/balance");
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export interface StreamCallbacks {
  onToken: (text: string) => void;
  onToolUse: (name: string) => void;
  onDone: (fullText: string) => void;
  onError: (message: string) => void;
}

export async function streamChat(
  message: string,
  callbacks: StreamCallbacks,
): Promise<void> {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message }),
  });

  if (!res.ok) {
    callbacks.onError(`HTTP ${res.status}`);
    return;
  }

  const reader = res.body?.getReader();
  if (!reader) {
    callbacks.onError("No response body");
    return;
  }

  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    let currentEvent = "";
    for (const line of lines) {
      if (line.startsWith("event:")) {
        currentEvent = line.slice(6).trim();
      } else if (line.startsWith("data:")) {
        const dataStr = line.slice(5).trim();
        if (!dataStr) continue;
        try {
          const data = JSON.parse(dataStr);
          switch (currentEvent) {
            case "token":
              callbacks.onToken(data.text);
              break;
            case "tool_use":
              callbacks.onToolUse(data.name);
              break;
            case "done":
              callbacks.onDone(data.text);
              break;
            case "error":
              callbacks.onError(data.error);
              break;
          }
        } catch {
          // Skip malformed JSON
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Grocery API
// ---------------------------------------------------------------------------

export interface GroceryItem {
  name: string;
  quantity: number;
  unit: string;
  raw_line: string;
}

export interface ShoppingItemResult {
  item: GroceryItem;
  status: "pending" | "purchasing" | "purchased" | "skipped" | "failed";
  credits?: number;
  error?: string;
}

export interface HistoryEntry {
  id: string;
  timestamp: string;
  sellerName: string;
  sellerUrl: string;
  items: ShoppingItemResult[];
  summary: { purchased: number; skipped: number; failed: number; total_credits: number };
  rating: number | null;
  review: string;
}

export interface ShopCallbacks {
  onItemStart: (index: number, total: number, item: GroceryItem) => void;
  onItemDone: (index: number, item: GroceryItem, status: string, credits?: number, error?: string) => void;
  onDone: (summary: {
    purchased: number;
    skipped: number;
    failed: number;
    total_credits: number;
    seller_name?: string;
    seller_url?: string;
    results?: Array<{
      item: GroceryItem;
      status: string;
      credits?: number;
      error?: string;
    }>;
  }) => void;
  onError: (message: string) => void;
}

export async function parseGroceryText(text: string): Promise<GroceryItem[]> {
  const res = await fetch("/api/grocery/parse", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Parse failed" }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  const data = await res.json();
  return data.items;
}

export async function parseGroceryFile(file: File): Promise<GroceryItem[]> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch("/api/grocery/parse", {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Parse failed" }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  const data = await res.json();
  return data.items;
}

export async function shopGroceryList(
  items: GroceryItem[],
  callbacks: ShopCallbacks,
): Promise<void> {
  const res = await fetch("/api/grocery/shop", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items }),
  });

  if (!res.ok) {
    callbacks.onError(`HTTP ${res.status}`);
    return;
  }

  const reader = res.body?.getReader();
  if (!reader) {
    callbacks.onError("No response body");
    return;
  }

  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    let currentEvent = "";
    for (const line of lines) {
      if (line.startsWith("event:")) {
        currentEvent = line.slice(6).trim();
      } else if (line.startsWith("data:")) {
        const dataStr = line.slice(5).trim();
        if (!dataStr) continue;
        try {
          const data = JSON.parse(dataStr);
          switch (currentEvent) {
            case "item_start":
              callbacks.onItemStart(data.index, data.total, data.item);
              break;
            case "item_done":
              callbacks.onItemDone(data.index, data.item, data.status, data.credits, data.error);
              break;
            case "shopping_done":
              callbacks.onDone(data);
              break;
          }
        } catch {
          // skip malformed JSON
        }
      }
    }
  }
}

const HISTORY_STORAGE_KEY = "grocery_history";

export function loadHistory(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(HISTORY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveHistory(entries: HistoryEntry[]): void {
  try {
    localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // ignore
  }
}

export async function submitReview(
  sellerUrl: string,
  sellerName: string,
  rating: number,
  review: string,
): Promise<void> {
  const res = await fetch("/api/grocery/review", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      seller_url: sellerUrl,
      seller_name: sellerName,
      rating,
      review,
    }),
  });
  if (!res.ok) {
    throw new Error(`Failed to submit review: ${res.status}`);
  }
}

// ---------------------------------------------------------------------------
// Log stream
// ---------------------------------------------------------------------------

export function connectLogStream(
  onLog: (entry: LogEntry) => void,
): () => void {
  const es = new EventSource("/api/logs/stream");

  es.addEventListener("log", (e) => {
    try {
      const entry: LogEntry = JSON.parse(e.data);
      onLog(entry);
    } catch {
      // Skip malformed entries
    }
  });

  es.addEventListener("error", () => {
    // EventSource auto-reconnects
  });

  return () => es.close();
}
