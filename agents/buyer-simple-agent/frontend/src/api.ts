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
  const data = await res.json();
  if (!Array.isArray(data)) return [];
  return data.map((s: Record<string, unknown>) => ({
    url: String(s?.url ?? ""),
    name: typeof s?.name === "string" ? s.name : (Array.isArray(s?.name) ? s.name.join(", ") : String(s?.name ?? "Unknown")),
    description: typeof s?.description === "string" ? s.description : "",
    skills: Array.isArray(s?.skills) ? s.skills.map((sk: unknown) => typeof sk === "string" ? sk : (sk && typeof sk === "object" && "name" in (sk as object) ? String((sk as { name?: unknown }).name) : String(sk))) : [],
    credits: typeof s?.credits === "number" ? s.credits : 1,
    cost_description: typeof s?.cost_description === "string" ? s.cost_description : "",
  }));
}

export async function fetchBalance(): Promise<{
  balance: Record<string, unknown>;
  budget: Record<string, unknown>;
  trustnet_balance?: number;
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

export interface ContextSaveEvent {
  timestamp: string;
  session_id: string;
  task: string;
  outcome: string;
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
  onContextSaved?: (save: ContextSaveEvent) => void;
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
            case "context_saved":
              callbacks.onContextSaved?.(data);
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
const USER_PROFILE_KEY = "shopmate_user_profile";
const USER_BUDGET_KEY = "shopmate_user_budget";

export interface UserProfile {
  name: string;
  email: string;
  tel: string;
  address: string;
}

export const DEFAULT_PROFILE: UserProfile = {
  name: "",
  email: "",
  tel: "",
  address: "",
};

export function loadProfile(): UserProfile {
  try {
    const raw = localStorage.getItem(USER_PROFILE_KEY);
    if (!raw) return { ...DEFAULT_PROFILE };
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_PROFILE, ...parsed };
  } catch {
    return { ...DEFAULT_PROFILE };
  }
}

export function saveProfile(profile: UserProfile): void {
  try {
    localStorage.setItem(USER_PROFILE_KEY, JSON.stringify(profile));
  } catch {
    // ignore
  }
}

export function loadBudget(): number {
  try {
    const raw = localStorage.getItem(USER_BUDGET_KEY);
    if (raw == null) return 100;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : 100;
  } catch {
    return 100;
  }
}

export function saveBudget(budget: number): void {
  try {
    localStorage.setItem(USER_BUDGET_KEY, String(Math.max(0, budget)));
  } catch {
    // ignore
  }
}

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

export interface ProductInfo {
  image: string | null;
  url: string | null;
  name: string;
  price: string | null;
  price_currency: string | null;
  brand: string | null;
  rating: number | null;
  review_count: number | null;
  store: string;
}

export interface AvailabilityResult {
  item_name: string;
  found: boolean;
  store: string;
  product_count: number;
  top_match: string | null;
  error: string | null;
  products?: ProductInfo[];
}

export async function checkEcommerceAvailability(
  items: string[] | { name: string }[],
): Promise<AvailabilityResult[]> {
  const itemNames = items.map((it) =>
    typeof it === "string" ? it : it.name,
  );
  const res = await fetch("/api/grocery/check-availability", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items: itemNames }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Check failed" }));
    const msg = err.error || `HTTP ${res.status}`;
    throw new Error(`${msg} (${res.status})`);
  }
  const data = await res.json();
  return data.results ?? [];
}

// ---------------------------------------------------------------------------
// Prompta leads (marketing — find customers with grocery shopping needs)
// ---------------------------------------------------------------------------

export interface LeadsResult {
  status: "success" | "error" | "payment_required";
  content?: Array<{ text: string }>;
  response?: string;
  credits_used?: number;
}

export async function fetchLeads(): Promise<LeadsResult> {
  const res = await fetch("/api/leads/get", { method: "POST" });
  const data = await res.json();
  if (!res.ok) {
    return {
      status: "error",
      content: [{ text: data.error || `HTTP ${res.status}` }],
      credits_used: 0,
    };
  }
  return data as LeadsResult;
}

// ---------------------------------------------------------------------------
// Shop Mate Seller Reviews (purchase review data)
// ---------------------------------------------------------------------------

export interface ReviewsResult {
  status: "success" | "error" | "payment_required";
  content?: Array<{ text: string }>;
  response?: string;
  credits_used?: number;
}

export async function fetchReviews(query?: string): Promise<ReviewsResult> {
  const res = await fetch("/api/reviews/purchase", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: query ?? "" }),
  });
  const data = await res.json();
  if (!res.ok) {
    return {
      status: "error",
      content: [{ text: data.error || `HTTP ${res.status}` }],
      credits_used: 0,
    };
  }
  return data as ReviewsResult;
}

// ---------------------------------------------------------------------------
// Trust Net (rank/verify sellers)
// ---------------------------------------------------------------------------

export interface TrustNetAgent {
  id?: string;
  name?: string;
  trust_score?: number;
  star_rating?: number;
  reviews?: number;
  price?: string;
  verified?: boolean;
  [key: string]: unknown;
}

export async function fetchTrustNetAgents(): Promise<{
  agents?: TrustNetAgent[];
  items?: TrustNetAgent[];
  raw?: string;
  error?: string;
}> {
  const res = await fetch("/api/trustnet/agents");
  const data = await res.json();
  if (!res.ok) return { error: data.error || `HTTP ${res.status}` };
  // Backend may return agents or items; normalize to agents
  const out = data as { agents?: TrustNetAgent[]; items?: TrustNetAgent[]; raw?: string; error?: string };
  if (out.agents) return out;
  if (Array.isArray(out.items)) {
    return { ...out, agents: out.items };
  }
  return out;
}

export async function fetchTrustNetReviews(agentId: string): Promise<{
  reviews?: unknown[];
  error?: string;
}> {
  const res = await fetch(`/api/trustnet/reviews?agent_id=${encodeURIComponent(agentId)}`);
  const data = await res.json();
  if (!res.ok) return { error: data.error || `HTTP ${res.status}` };
  return data;
}

export async function submitTrustNetReview(params: {
  agent_id: string;
  reviewer_address: string;
  verification_tx: string;
  score: number;
  comment: string;
}): Promise<{ error?: string }> {
  const res = await fetch("/api/trustnet/review", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  const data = await res.json();
  if (!res.ok) return { error: data.error || `HTTP ${res.status}` };
  return data;
}

// ---------------------------------------------------------------------------
// Platon (persistent context)
// ---------------------------------------------------------------------------

export interface ContextSave {
  timestamp: string;
  session_id: string;
  task: string;
  outcome: string;
}

export async function fetchContextSaves(): Promise<ContextSave[]> {
  const res = await fetch("/api/platon/context-saves");
  if (!res.ok) return [];
  const data = await res.json();
  const saves = data?.saves ?? [];
  return Array.isArray(saves) ? saves : [];
}

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
