import { useState, useMemo } from "react";
import { Users, Loader2, AlertCircle, User, Info } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { fetchLeads, type LeadsResult } from "@/api";

const PROMPTA_CHECKOUT_URL =
  "https://nevermined.app/checkout/28744455506253719439355309070854035710561167109692836172020876792102066260600";

export interface ParsedLead {
  index: number;
  name: string;
  contact: string;
  note: string;
  raw: string;
}

function parseLeadsFromResponse(text: string | null): ParsedLead[] {
  if (!text?.trim()) return [];

  // Try JSON array first
  const trimmed = text.trim();
  const jsonMatch = trimmed.match(/\[[\s\S]*\]/);
  if (jsonMatch) {
    try {
      const arr = JSON.parse(jsonMatch[0]) as unknown[];
      return arr.slice(0, 10).map((item, i) => {
        const o = item as Record<string, unknown>;
        return {
          index: i + 1,
          name: String(o?.name ?? o?.Name ?? "Unknown"),
          contact: String(o?.email ?? o?.contact ?? o?.phone ?? o?.Contact ?? ""),
          note: String(o?.note ?? o?.notes ?? o?.needs ?? ""),
          raw: JSON.stringify(item),
        };
      });
    } catch {
      // fall through to text parsing
    }
  }

  // Parse numbered list: "1. Name - contact - note" or "1) Name - contact"
  // Also bullet points: "• Name - contact" or "- Name - contact"
  const lines = trimmed.split(/\n+/);
  const leads: ParsedLead[] = [];
  const numPattern = /^(\d+)[.)]\s*(.+)$/;
  const bulletPattern = /^[•\-*]\s*(.+)$/;

  for (const line of lines) {
    if (leads.length >= 10) break;
    const m = line.trim().match(numPattern);
    const bullet = line.trim().match(bulletPattern);
    const rest = m ? m[2] : bullet ? bullet[1] : line.trim();
    if (rest.length > 2) {
      const parts = rest.split(/\s*[-–—|:,]\s*/).map((p) => p.trim()).filter(Boolean);
      if (parts.length > 0) {
        const namePart = parts[0] ?? "Unknown";
        const contactPart = parts.find((p) => /@/.test(p) || /^\d{10,}$/.test(p)) ?? parts[1] ?? "";
        const notePart = parts.slice(2).join(" — ") || "";
        leads.push({
          index: leads.length + 1,
          name: namePart,
          contact: contactPart,
          note: notePart,
          raw: rest,
        });
      }
    }
  }

  return leads.slice(0, 10);
}

export default function GetLeads() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<LeadsResult | null>(null);

  const handleGetLead = async () => {
    setLoading(true);
    setResult(null);
    try {
      const data = await fetchLeads();
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

  const parsedLeads = useMemo(
    () => (result?.status === "success" ? parseLeadsFromResponse(textContent ?? null) : []),
    [result?.status, textContent],
  );

  const hasParsedLeads = parsedLeads.length > 0;

  return (
    <Card className="border-[var(--color-nvm-teal)]/30">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Users className="h-5 w-5 text-[var(--color-nvm-teal)]" />
          Prompta Lead Generation
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Find 10 customers or leads who have grocery shopping needs and would use
          Shop Mate. Powered by Prompta marketing service.
        </p>
        <a
          href={PROMPTA_CHECKOUT_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-[var(--color-nvm-teal)] hover:underline"
        >
          Subscribe to Prompta at nevermined.app →
        </a>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-lg border bg-muted/30 p-4 text-sm">
          <h4 className="mb-2 flex items-center gap-2 font-medium">
            <Info className="h-4 w-4 text-[var(--color-nvm-teal)]" />
            How it works
          </h4>
          <p className="text-muted-foreground">
            Click &quot;Get 10 Leads&quot; to fetch users with grocery shopping needs from Prompta.
            The agent endpoint is resolved automatically from Nevermined. Subscribe first if needed.
          </p>
        </div>
        <Button
          onClick={handleGetLead}
          disabled={loading}
          className="bg-gradient-to-r from-[var(--color-nvm-teal)] to-[var(--color-nvm-lime)] text-white hover:opacity-90"
        >
          {loading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Fetching 10 leads…
            </>
          ) : (
            <>
              <Users className="mr-2 h-4 w-4" />
              Get 10 Leads
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

        {hasParsedLeads && (
          <div className="space-y-2">
            <h3 className="text-sm font-medium text-muted-foreground">
              {parsedLeads.length} leads
            </h3>
            <ScrollArea className="h-[400px] rounded-lg border">
              <div className="grid gap-2 p-3">
                {parsedLeads.map((lead) => (
                  <div
                    key={lead.index}
                    className="flex items-start gap-3 rounded-lg border bg-card p-3 text-sm"
                  >
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--color-nvm-teal)]/20 text-[var(--color-nvm-teal)]">
                      <User className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1 space-y-1">
                      <p className="font-medium">{lead.name}</p>
                      {lead.contact && (
                        <p className="text-xs text-muted-foreground">
                          {lead.contact}
                        </p>
                      )}
                      {lead.note && (
                        <p className="text-xs text-muted-foreground">
                          {lead.note}
                        </p>
                      )}
                    </div>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      #{lead.index}
                    </span>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </div>
        )}

        {result?.status === "success" && !hasParsedLeads && textContent && (
          <div className="rounded-lg border border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950/50 p-4 text-sm">
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
