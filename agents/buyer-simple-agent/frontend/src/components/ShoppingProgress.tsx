import { useState } from "react";
import { CheckCircle2, XCircle, Loader2, Ban, ShoppingBag } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import StarRating from "./StarRating";
import type { GroceryItem } from "@/api";

export type ItemStatus = "pending" | "purchasing" | "purchased" | "skipped" | "failed";

export interface ShoppingItem {
  item: GroceryItem;
  status: ItemStatus;
  credits?: number;
  error?: string;
}

interface ShoppingSummary {
  purchased: number;
  skipped: number;
  failed: number;
  total_credits: number;
  seller_name?: string;
  seller_url?: string;
}

interface ShoppingProgressProps {
  items: ShoppingItem[];
  summary: ShoppingSummary | null;
  isShopping: boolean;
  onRateSubmit?: (rating: number, review: string) => void;
}

function StatusIcon({ status }: { status: ItemStatus }) {
  switch (status) {
    case "purchased":
      return <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />;
    case "failed":
      return <XCircle className="h-4 w-4 text-red-500 shrink-0" />;
    case "skipped":
      return <Ban className="h-4 w-4 text-amber-500 shrink-0" />;
    case "purchasing":
      return <Loader2 className="h-4 w-4 text-[var(--color-nvm-teal)] animate-spin shrink-0" />;
    default:
      return <div className="h-4 w-4 rounded-full border-2 border-muted shrink-0" />;
  }
}

function StatusBadge({ status, credits }: { status: ItemStatus; credits?: number }) {
  switch (status) {
    case "purchased":
      return <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 text-[11px]">{credits ?? 1} cr</Badge>;
    case "failed":
      return <Badge variant="destructive" className="text-[11px]">Failed</Badge>;
    case "skipped":
      return <Badge className="bg-amber-100 text-amber-700 border-amber-200 text-[11px]">Skipped</Badge>;
    case "purchasing":
      return <Badge className="bg-[var(--color-nvm-teal)]/10 text-[var(--color-nvm-teal)] border-[var(--color-nvm-teal)]/20 text-[11px]">Buying...</Badge>;
    default:
      return null;
  }
}

export default function ShoppingProgress({
  items,
  summary,
  isShopping,
  onRateSubmit,
}: ShoppingProgressProps) {
  const [rating, setRating] = useState(5);
  const [reviewText, setReviewText] = useState("");
  const [ratingSubmitted, setRatingSubmitted] = useState(false);
  const processed = items.filter((i) => i.status !== "pending" && i.status !== "purchasing").length;

  const handleSubmitRating = () => {
    onRateSubmit?.(rating, reviewText);
    setRatingSubmitted(true);
  };

  return (
    <Card className="w-full max-w-2xl mx-auto">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <ShoppingBag className="h-5 w-5 text-[var(--color-nvm-teal)]" />
          Shopping Progress
        </CardTitle>
        {isShopping && (
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            <span>Processing {processed}/{items.length} items...</span>
          </div>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Progress bar */}
        <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
          <div
            className="h-full rounded-full bg-gradient-to-r from-[var(--color-nvm-teal)] to-[var(--color-nvm-lime)] transition-all duration-500"
            style={{ width: `${items.length ? (processed / items.length) * 100 : 0}%` }}
          />
        </div>

        {/* Items list */}
        <ScrollArea className="max-h-[360px]">
          <div className="space-y-1">
            {items.map((si, idx) => (
              <div
                key={idx}
                className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
                  si.status === "purchasing" ? "bg-[var(--color-nvm-teal)]/5" : ""
                }`}
              >
                <StatusIcon status={si.status} />
                <span className="flex-1 truncate">
                  <span className="text-muted-foreground mr-1.5">
                    {si.item.quantity}{si.item.unit !== "each" ? ` ${si.item.unit}` : "x"}
                  </span>
                  {si.item.name}
                </span>
                <StatusBadge status={si.status} credits={si.credits} />
              </div>
            ))}
          </div>
        </ScrollArea>

        {/* Summary */}
        {summary && (
          <div className="rounded-xl bg-muted/50 p-4 grid grid-cols-4 gap-4 text-center">
            <div>
              <div className="text-2xl font-bold text-emerald-600">{summary.purchased}</div>
              <div className="text-xs text-muted-foreground">Purchased</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-amber-600">{summary.skipped}</div>
              <div className="text-xs text-muted-foreground">Skipped</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-red-600">{summary.failed}</div>
              <div className="text-xs text-muted-foreground">Failed</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-[var(--color-nvm-teal)]">{summary.total_credits}</div>
              <div className="text-xs text-muted-foreground">Credits</div>
            </div>
          </div>
        )}

        {/* Rate this seller (after shopping completes) */}
        {!isShopping && summary && summary.seller_name && onRateSubmit && !ratingSubmitted && (
          <div className="rounded-xl border p-4 space-y-2">
            <p className="text-sm font-medium">Rate {summary.seller_name}</p>
            <div className="flex items-center gap-3">
              <StarRating value={rating} onChange={setRating} size="md" />
              <textarea
                placeholder="Optional review..."
                value={reviewText}
                onChange={(e) => setReviewText(e.target.value)}
                rows={1}
                className="flex-1 resize-none rounded border bg-background px-2 py-1.5 text-sm"
              />
              <Button size="sm" onClick={handleSubmitRating} className="shrink-0">
                Submit
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
