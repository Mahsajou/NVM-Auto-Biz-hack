import { useState } from "react";
import { ChevronDown, ChevronRight, History, Store } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import StarRating from "./StarRating";
import {
  type HistoryEntry,
  saveHistory,
  submitReview,
} from "@/api";

interface ShoppingHistoryProps {
  entries: HistoryEntry[];
  onEntriesChange: (entries: HistoryEntry[]) => void;
  onRatingChange?: (entryId: string, rating: number | null) => void;
  fullHeight?: boolean;
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export default function ShoppingHistory({
  entries,
  onEntriesChange,
  onRatingChange,
  fullHeight = false,
}: ShoppingHistoryProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<string | null>(null);

  const handleInlineRate = async (entry: HistoryEntry, rating: number) => {
    if (entry.rating != null) return;
    onRatingChange?.(entry.id, rating);
    setSubmitting(entry.id);
    try {
      await submitReview(entry.sellerUrl, entry.sellerName, rating, "");
    } catch {
      onRatingChange?.(entry.id, null);
    } finally {
      setSubmitting(null);
    }
  };

  if (entries.length === 0) {
    return (
      <Card className={fullHeight ? "w-full h-full flex flex-col min-h-0" : "w-full"}>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <History className="h-4 w-4 text-muted-foreground" />
            Shopping History
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Your past grocery orders will appear here.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={fullHeight ? "w-full h-full flex flex-col min-h-0" : "w-full"}>
      <CardHeader className="pb-2 shrink-0">
        <CardTitle className="flex items-center gap-2 text-base">
          <History className="h-4 w-4 text-muted-foreground" />
          Shopping History
        </CardTitle>
      </CardHeader>
      <CardContent className={fullHeight ? "flex-1 min-h-0 overflow-hidden" : ""}>
        <ScrollArea className={fullHeight ? "h-full" : "max-h-[280px]"}>
          <div className="space-y-2">
            {entries.slice().reverse().map((entry) => {
              const isExpanded = expandedId === entry.id;

              return (
                <div
                  key={entry.id}
                  className="rounded-lg border bg-card text-card-foreground overflow-hidden"
                >
                  <div className="flex items-center gap-2 px-3 py-2.5">
                    <button
                      type="button"
                      onClick={() => setExpandedId(isExpanded ? null : entry.id)}
                      className="flex items-center gap-2 text-left hover:bg-muted/50 rounded transition-colors -m-1 p-1 shrink-0"
                    >
                      {isExpanded ? (
                        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                      )}
                    </button>
                    <Store className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="truncate text-sm font-medium min-w-0">
                      {entry.sellerName}
                    </span>
                    <div
                      className="shrink-0"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <StarRating
                        value={entry.rating ?? 0}
                        onChange={(r) => handleInlineRate(entry, r)}
                        readonly={entry.rating != null}
                        size="sm"
                      />
                    </div>
                    {submitting === entry.id && (
                      <span className="text-xs text-muted-foreground shrink-0">Saving...</span>
                    )}
                    <span className="flex-1" />
                    <span className="text-xs text-muted-foreground shrink-0">
                      {formatDate(entry.timestamp)}
                    </span>
                    <span className="text-xs text-[var(--color-nvm-teal)] shrink-0">
                      {entry.summary.total_credits} cr
                    </span>
                  </div>

                  {isExpanded && (
                    <div className="border-t px-3 py-2 space-y-3 text-sm">
                      <div className="text-muted-foreground">
                        {entry.summary.purchased} purchased, {entry.summary.skipped} skipped,{" "}
                        {entry.summary.failed} failed
                      </div>
                      <ul className="space-y-1 max-h-24 overflow-y-auto">
                        {entry.items.map((si, i) => (
                          <li key={i} className="flex items-center gap-2">
                            <span className="text-muted-foreground">
                              {si.item.quantity}{si.item.unit !== "each" ? ` ${si.item.unit}` : "x"}
                            </span>
                            <span>{si.item.name}</span>
                            {si.status === "purchased" && si.credits && (
                              <span className="text-xs text-muted-foreground">
                                ({si.credits} cr)
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>

                      {entry.review && (
                        <div className="pt-2 border-t">
                          <p className="text-muted-foreground text-xs italic">
                            {entry.review}
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
