import { useEffect, useState } from "react";
import { Database } from "lucide-react";
import { fetchContextSaves, type ContextSave } from "../api";

export interface ContextToolProps {
  lastSavedAt?: string | null;
}

function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

export default function ContextTool({ lastSavedAt }: ContextToolProps) {
  const [saves, setSaves] = useState<ContextSave[]>([]);

  useEffect(() => {
    const load = () => {
      fetchContextSaves().then(setSaves);
    };
    load();
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex flex-col h-full p-6 space-y-4">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Database className="h-5 w-5" />
        <h2 className="text-lg font-medium">Context Tool</h2>
      </div>
      {lastSavedAt && (
        <div className="rounded-lg border border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950/50 px-4 py-2 text-sm text-green-800 dark:text-green-200">
          Context saved at {formatTimestamp(lastSavedAt)}
        </div>
      )}
      <p className="text-sm text-muted-foreground">
        Platon saves your agent context after grocery shopping and other tasks.
        Each save includes the task, outcome, and timestamp.
      </p>
      {saves.length === 0 ? (
        <div className="rounded-xl border border-dashed border-muted-foreground/30 bg-muted/20 p-8 text-center text-muted-foreground">
          <p className="text-sm">No context saves yet.</p>
          <p className="text-xs mt-1">
            Complete a grocery shop to save context to Platon.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {[...saves].reverse().map((s, i) => (
            <li
              key={`${s.session_id}-${i}`}
              className="rounded-xl border bg-card p-4 shadow-sm"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-medium text-green-600 dark:text-green-400">
                    Context saved
                  </p>
                  <p className="text-sm text-muted-foreground mt-0.5">
                    {formatTimestamp(s.timestamp)}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Task: {s.task} · Outcome: {s.outcome}
                  </p>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
