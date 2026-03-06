import { useState } from "react";
import { Star, Loader2, AlertCircle, Info } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { fetchReviews, type ReviewsResult } from "@/api";

export default function BuyReviews() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ReviewsResult | null>(null);
  const [query, setQuery] = useState("");

  const handleBuyReviews = async () => {
    setLoading(true);
    setResult(null);
    try {
      const data = await fetchReviews(query);
      setResult(data);
    } catch (err) {
      setResult({
        status: "error",
        content: [{ text: String(err) }],
        credits_used: 0,
      });
    } finally {
      setLoading(false);
    }
  };

  const textContent =
    result?.content?.[0]?.text ?? result?.response ?? null;

  return (
    <Card className="border-[var(--color-nvm-teal)]/30">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Star className="h-5 w-5 text-[var(--color-nvm-teal)]" />
          Shop Mate Seller Reviews
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Purchase review data from the Shop Mate Seller Reviews agent. Get
          reviews you&apos;ve made for sellers — seller name, rating, and
          review text.
        </p>
        <a
          href="https://nevermined.app/checkout/105770377365895420516068789314715951313306586166892856219570381354903905486817"
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-[var(--color-nvm-teal)] hover:underline"
        >
          Subscribe to this plan at nevermined.app →
        </a>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-lg border bg-muted/30 p-4 text-sm">
          <h4 className="mb-2 flex items-center gap-2 font-medium">
            <Info className="h-4 w-4 text-[var(--color-nvm-teal)]" />
            About this service
          </h4>
          <ul className="space-y-1.5 text-muted-foreground">
            <li>
              <strong>What it is:</strong> A seller agent that sells review data — reviews you&apos;ve made for grocery sellers after shopping.
            </li>
            <li>
              <strong>What you get:</strong> Seller name, rating (1–5), and review text for each review.
            </li>
            <li>
              <strong>How it works:</strong> Subscribe to the plan at nevermined.app, then use credits here to purchase review data. Each request consumes credits.
            </li>
            <li>
              <strong>Optional query:</strong> Filter by topic (e.g. &quot;reviews for grocery sellers&quot;) or leave empty for all available reviews.
            </li>
          </ul>
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium">Optional query</label>
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="e.g. reviews for grocery sellers"
            className="max-w-md"
          />
        </div>
        <Button
          onClick={handleBuyReviews}
          disabled={loading}
          className="bg-gradient-to-r from-[var(--color-nvm-teal)] to-[var(--color-nvm-lime)] text-white hover:opacity-90"
        >
          {loading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Purchasing…
            </>
          ) : (
            <>
              <Star className="mr-2 h-4 w-4" />
              Buy Reviews
            </>
          )}
        </Button>

        {result && result.status !== "success" && (
          <div className="rounded-lg border border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950/50 p-4 text-sm">
            {result.status === "error" && (
              <div className="mb-2 flex items-center gap-2 text-red-700 dark:text-red-300">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span className="font-medium">Error</span>
              </div>
            )}
            {result.status === "payment_required" && (
              <div className="mb-2 flex items-center gap-2 text-amber-700 dark:text-amber-300">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span className="font-medium">Payment required</span>
              </div>
            )}
            {textContent && (
              <pre className="whitespace-pre-wrap break-words font-sans text-inherit">
                {textContent}
              </pre>
            )}
          </div>
        )}

        {result?.status === "success" && textContent && (
          <div className="rounded-lg border border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950/50 p-4 text-sm">
            <h3 className="mb-2 font-medium text-green-800 dark:text-green-200">
              Reviews
            </h3>
            <pre className="whitespace-pre-wrap break-words font-sans text-inherit">
              {textContent}
            </pre>
          </div>
        )}

        {result?.credits_used != null && result.credits_used > 0 && (
          <p className="text-xs text-muted-foreground">
            Credits used: {result.credits_used}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
