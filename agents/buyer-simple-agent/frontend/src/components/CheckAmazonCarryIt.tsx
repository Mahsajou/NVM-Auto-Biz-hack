import { useState } from "react";
import { ShoppingBag, Check, X, Loader2, ExternalLink, Star } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  checkEcommerceAvailability,
  type AvailabilityResult,
  type ProductInfo,
  type GroceryItem,
} from "@/api";

function ProductCard({ product }: { product: ProductInfo }) {
  const storeLabel = product.store === "walmart" ? "Walmart" : "Amazon";
  return (
    <a
      href={product.url || "#"}
      target="_blank"
      rel="noopener noreferrer"
      className="flex gap-3 rounded-lg border bg-card p-3 hover:bg-muted/50 transition-colors text-left"
    >
      {product.image && (
        <img
          src={product.image}
          alt={product.name}
          className="h-16 w-16 shrink-0 rounded object-cover"
        />
      )}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium line-clamp-2">{product.name}</p>
        {product.brand && (
          <p className="text-xs text-muted-foreground">{product.brand}</p>
        )}
        <div className="mt-1 flex items-center gap-2 text-xs">
          {product.price && (
            <span className="font-semibold text-[var(--color-nvm-teal)]">
              {product.price}
            </span>
          )}
          {product.rating != null && (
            <span className="flex items-center gap-0.5 text-amber-600">
              <Star className="h-3 w-3 fill-current" />
              {product.rating.toFixed(1)}
            </span>
          )}
          {product.review_count != null && (
            <span className="text-muted-foreground">
              ({product.review_count} reviews)
            </span>
          )}
        </div>
        <span className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground">
          {storeLabel}
          <ExternalLink className="h-3 w-3" />
        </span>
      </div>
    </a>
  );
}

interface CheckAmazonCarryItProps {
  /** Optional: use current shopping list items. If empty, user can enter items manually. */
  shoppingListItems?: GroceryItem[];
  disabled?: boolean;
}

export default function CheckAmazonCarryIt({
  shoppingListItems = [],
  disabled = false,
}: CheckAmazonCarryItProps) {
  const [manualItems, setManualItems] = useState("");
  const [results, setResults] = useState<AvailabilityResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasList = shoppingListItems.length > 0;
  // Parse manual input: newlines or commas
  const parseManualItems = (text: string) =>
    text
      .split(/[\n,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
  const manualParsed = parseManualItems(manualItems);
  const listItems = hasList ? shoppingListItems.map((i) => i.name) : [];
  const itemsToCheck = [...new Set([...listItems, ...manualParsed])];

  const handleCheck = async () => {
    if (itemsToCheck.length === 0) {
      setError(hasList ? "No items in your list" : "Enter at least one item");
      return;
    }
    setError(null);
    setResults(null);
    setLoading(true);
    try {
      const data = await checkEcommerceAvailability(itemsToCheck);
      setResults(data);
      // If all results have the same error (e.g. API key), show as banner
      const errs = data.filter((r) => r.error).map((r) => r.error);
      const allSameErr = errs.length > 0 && errs.every((e) => e === errs[0]);
      if (allSameErr && errs[0]?.includes("APIFY_API_KEY")) {
        setError(
          "Add APIFY_API_KEY to your .env file. Get a key from https://console.apify.com/account/integrations",
        );
      } else {
        setError(null);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Check failed";
      if (msg.includes("Failed to fetch") || msg.includes("NetworkError")) {
        setError(
          "Backend not reachable. Start it with: cd agents/buyer-simple-agent && poetry run python -m src.web",
        );
      } else if (msg.includes("404")) {
        setError(
          "Route not found (404). Restart the backend to load the latest code: stop it with Ctrl+C, then run poetry run python -m src.web",
        );
      } else if (msg.includes("503")) {
        setError(
          "Apify client not installed. Run: cd agents/buyer-simple-agent && poetry add apify-client",
        );
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="w-full">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-lg">
          <ShoppingBag className="h-5 w-5 text-[var(--color-nvm-teal)]" />
          Check Amazon & Walmart
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Search Amazon and Walmart for items. See prices, ratings, and product details.
          This does not make purchases — it only checks availability.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <label className="text-sm font-medium">
            {hasList
              ? "Add more items to check, or use your list below"
              : "Type items or brands to check"}
          </label>
          <textarea
            placeholder="e.g. organic milk, Kirkland paper towels, Oatly oat milk"
            value={manualItems}
            onChange={(e) => setManualItems(e.target.value)}
            rows={3}
            className="w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-nvm-teal)] focus-visible:ring-offset-1"
            disabled={disabled}
          />
          <p className="text-xs text-muted-foreground">
            Separate with commas or new lines. Examples: organic milk, Kirkland paper
            towels, Oatly oat milk
          </p>
        </div>
        {hasList && (
          <p className="text-sm text-muted-foreground">
            Or check {shoppingListItems.length} items from your shopping list
          </p>
        )}

        <Button
          onClick={handleCheck}
          disabled={disabled || loading || itemsToCheck.length === 0}
          className="bg-gradient-to-r from-[var(--color-nvm-teal)] to-[var(--color-nvm-lime)] text-white"
        >
          {loading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
              Checking...
            </>
          ) : (
            "Search Amazon & Walmart"
          )}
        </Button>

        {error && (
          <div className="space-y-2">
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {error}
            </div>
            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer hover:text-foreground">
                Common fixes
              </summary>
              <ul className="mt-2 space-y-1 list-disc list-inside">
                <li>Restart backend: <code className="bg-muted px-1 rounded">poetry run python -m src.web</code></li>
                <li>Add <code className="bg-muted px-1 rounded">APIFY_API_KEY</code> to <code className="bg-muted px-1 rounded">.env</code></li>
                <li>Install: <code className="bg-muted px-1 rounded">poetry add apify-client</code></li>
              </ul>
            </details>
          </div>
        )}

        {results && (
          <div className="space-y-4">
            <h4 className="text-sm font-medium">Results</h4>
            <div className="space-y-4">
              {results.map((r, i) => (
                <div key={i} className="space-y-2">
                  <div className="flex items-center gap-2">
                    {r.found ? (
                      <Check className="h-4 w-4 text-green-600 shrink-0" />
                    ) : (
                      <X className="h-4 w-4 text-red-500 shrink-0" />
                    )}
                    <span className="font-medium">{r.item_name}</span>
                    {r.found && r.product_count > 0 && (
                      <span className="text-xs text-muted-foreground">
                        — {r.product_count} product{r.product_count !== 1 ? "s" : ""} found
                      </span>
                    )}
                  </div>
                  {r.error && (
                    <p className="text-muted-foreground text-xs">{r.error}</p>
                  )}
                  {r.found && r.products && r.products.length > 0 && (
                    <div className="grid gap-3 sm:grid-cols-2">
                      {r.products.map((p: ProductInfo, j: number) => (
                        <ProductCard key={j} product={p} />
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
