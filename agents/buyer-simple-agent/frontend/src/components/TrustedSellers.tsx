import { useState, useEffect } from "react";
import { Shield, Star, Loader2, ChevronDown, ChevronRight, RefreshCw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import {
  fetchTrustNetAgents,
  fetchTrustNetReviews,
  submitTrustNetReview,
  type TrustNetAgent,
} from "@/api";

function SubmitReviewForm({
  agentId,
  onSubmit,
  isSubmitting,
  error,
  onErrorClear,
}: {
  agentId: string;
  agentName?: string;
  onSubmit: (
    agentId: string,
    reviewerAddress: string,
    verificationTx: string,
    score: number,
    comment: string,
  ) => Promise<void>;
  isSubmitting: boolean;
  error: string | null;
  onErrorClear: () => void;
}) {
  const [reviewerAddress, setReviewerAddress] = useState("");
  const [verificationTx, setVerificationTx] = useState("");
  const [score, setScore] = useState(5);
  const [comment, setComment] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    onErrorClear();
    await onSubmit(agentId, reviewerAddress, verificationTx, score, comment);
    setComment("");
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-2 pt-2 border-t">
      <h4 className="font-medium text-xs">Submit a review</h4>
      <p className="text-[11px] text-muted-foreground">
        Requires a real on-chain transaction hash (verification_tx). Fake hashes are rejected.
      </p>
      <div className="grid gap-1.5">
        <label className="text-xs font-medium">Ethereum address (0x...)</label>
        <Input
          value={reviewerAddress}
          onChange={(e) => setReviewerAddress(e.target.value)}
          placeholder="0x..."
          className="h-8 text-xs"
          required
        />
        <label className="text-xs font-medium">Verification tx hash</label>
        <Input
          value={verificationTx}
          onChange={(e) => setVerificationTx(e.target.value)}
          placeholder="0x..."
          className="h-8 text-xs"
          required
        />
        <label className="text-xs font-medium">Score (1–10)</label>
        <Input
          type="number"
          min={1}
          max={10}
          value={score}
          onChange={(e) => setScore(Number(e.target.value) || 5)}
          className="h-8 text-xs w-16"
        />
        <label className="text-xs font-medium">Comment</label>
        <Input
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Short review..."
          className="h-8 text-xs"
          required
        />
      </div>
      {error && (
        <p className="text-xs text-red-600">{error}</p>
      )}
      <Button
        type="submit"
        size="sm"
        disabled={isSubmitting || !reviewerAddress || !verificationTx || !comment}
        className="h-7 text-xs"
      >
        {isSubmitting ? "Submitting..." : "Submit review"}
      </Button>
    </form>
  );
}

export default function TrustedSellers() {
  const [agents, setAgents] = useState<TrustNetAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [reviews, setReviews] = useState<Record<string, unknown[]>>({});
  const [submittingReview, setSubmittingReview] = useState<string | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);

  useEffect(() => {
    loadAgents();
  }, []);

  const loadAgents = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchTrustNetAgents();
      if (data.error) {
        setError(data.error);
        setAgents([]);
        return;
      }
      // Handle different response shapes
      let list: TrustNetAgent[] = [];
      if (Array.isArray(data.agents)) {
        list = data.agents;
      } else if (data.raw && typeof data.raw === "string") {
        try {
          const parsed = JSON.parse(data.raw);
          list = Array.isArray(parsed) ? parsed : parsed.agents ?? [];
        } catch {
          list = [];
        }
      } else if (data && typeof data === "object" && "agents" in data) {
        list = (data as { agents?: TrustNetAgent[] }).agents ?? [];
      }
      // Sort by trust_score descending, verified first
      list.sort((a, b) => {
        const aVerified = a.verified ? 1 : 0;
        const bVerified = b.verified ? 1 : 0;
        if (bVerified !== aVerified) return bVerified - aVerified;
        return (b.trust_score ?? 0) - (a.trust_score ?? 0);
      });
      setAgents(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load agents");
      setAgents([]);
    } finally {
      setLoading(false);
    }
  };

  const loadReviews = async (agentId: string) => {
    if (reviews[agentId]) return;
    try {
      const data = await fetchTrustNetReviews(agentId);
      if (data.reviews) {
        setReviews((prev) => ({ ...prev, [agentId]: data.reviews! }));
      }
    } catch {
      // ignore
    }
  };

  const handleExpand = (agentId: string) => {
    setExpandedId((prev) => (prev === agentId ? null : agentId));
    setReviewError(null);
    if (agentId) loadReviews(agentId);
  };

  const handleSubmitReview = async (
    agentId: string,
    reviewerAddress: string,
    verificationTx: string,
    score: number,
    comment: string,
  ) => {
    setSubmittingReview(agentId);
    setReviewError(null);
    const result = await submitTrustNetReview({
      agent_id: agentId,
      reviewer_address: reviewerAddress,
      verification_tx: verificationTx,
      score,
      comment,
    });
    setSubmittingReview(null);
    if (result.error) {
      setReviewError(result.error);
      return;
    }
    setReviewError(null);
    loadReviews(agentId);
    loadAgents();
  };

  return (
    <Card className="w-full">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Shield className="h-5 w-5 text-[var(--color-nvm-teal)]" />
              Trusted Sellers
            </CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              Ranked and verified sellers from Trust Net. Sorted by trust score.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={loadAgents}
            disabled={loading}
            className="shrink-0"
          >
            <RefreshCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {loading && (
          <div className="flex items-center gap-2 py-8 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            Loading agents...
          </div>
        )}
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {error}
            <Button
              variant="outline"
              size="sm"
              className="mt-2"
              onClick={loadAgents}
            >
              Retry
            </Button>
          </div>
        )}
        {!loading && !error && agents.length === 0 && (
          <p className="text-sm text-muted-foreground py-4">
            No agents found. Ensure you&apos;re subscribed to the Trust Net USDC
            plan.
          </p>
        )}
        {!loading && !error && agents.length > 0 && (
          <ScrollArea className="max-h-[400px]">
            <div className="space-y-2">
              {agents.map((agent) => {
                const id = String(agent.id ?? agent.name ?? "");
                const isExpanded = expandedId === id;
                return (
                  <div
                    key={id}
                    className="rounded-lg border bg-card overflow-hidden"
                  >
                    <button
                      type="button"
                      onClick={() => handleExpand(id)}
                      className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-muted/50 transition-colors"
                    >
                      {isExpanded ? (
                        <ChevronDown className="h-4 w-4 shrink-0" />
                      ) : (
                        <ChevronRight className="h-4 w-4 shrink-0" />
                      )}
                      {agent.verified && (
                        <Shield className="h-4 w-4 text-green-600 shrink-0" />
                      )}
                      <span className="flex-1 truncate font-medium">
                        {agent.name ?? id}
                      </span>
                      {agent.trust_score != null && (
                        <span className="text-xs text-muted-foreground">
                          Score: {agent.trust_score}
                        </span>
                      )}
                      {agent.star_rating != null && (
                        <span className="flex items-center gap-0.5 text-amber-500">
                          <Star className="h-3.5 w-3.5 fill-current" />
                          {agent.star_rating}
                        </span>
                      )}
                      {agent.price && (
                        <span className="text-xs text-muted-foreground">
                          {agent.price}
                        </span>
                      )}
                    </button>
                    {isExpanded && (
                      <div className="border-t px-3 py-2 text-sm space-y-3">
                        {reviews[id]?.length ? (
                          <div>
                            <h4 className="font-medium text-xs mb-1">Reviews</h4>
                            <div className="space-y-1 max-h-32 overflow-y-auto">
                              {(reviews[id] as { score?: number; comment?: string }[]).map(
                                (r, i) => (
                                  <div
                                    key={i}
                                    className="text-xs text-muted-foreground"
                                  >
                                    {r.score != null && `★ ${r.score} `}
                                    {r.comment}
                                  </div>
                                )
                              )}
                            </div>
                          </div>
                        ) : (
                          <p className="text-xs text-muted-foreground">
                            Loading reviews...
                          </p>
                        )}
                        <SubmitReviewForm
                          agentId={id}
                          onSubmit={handleSubmitReview}
                          isSubmitting={submittingReview === id}
                          error={reviewError}
                          onErrorClear={() => setReviewError(null)}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
