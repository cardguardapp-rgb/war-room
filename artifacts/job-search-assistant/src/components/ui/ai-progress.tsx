import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Progress panel for long AI calls (20–60s). Cycles through plain-English
 * status messages so the screen is never dead. Pass a STABLE `stages` array
 * (define it at module scope) so the timer isn't reset on every render. The
 * parent unmounts this when the call resolves.
 */
export function AiProgress({
  stages,
  className,
  intervalMs = 4500,
}: {
  stages: string[];
  className?: string;
  intervalMs?: number;
}) {
  const [i, setI] = useState(0);

  useEffect(() => {
    setI(0);
    if (stages.length <= 1) return;
    const id = setInterval(() => {
      // Advance but hold on the final stage until the call finishes.
      setI((prev) => (prev < stages.length - 1 ? prev + 1 : prev));
    }, intervalMs);
    return () => clearInterval(id);
  }, [stages, intervalMs]);

  const msg = stages[Math.min(i, stages.length - 1)] ?? "Working…";
  // Cap short of 100% so it never looks "done" before it actually is.
  const pct = stages.length > 1 ? Math.min(92, ((i + 1) / stages.length) * 100) : 80;

  return (
    <div
      className={cn(
        "rounded-xl border border-border bg-muted/20 p-4 space-y-3",
        className,
      )}
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center gap-2 text-sm">
        <Loader2 className="w-4 h-4 animate-spin text-primary shrink-0" />
        <span className="font-medium">{msg}</span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
        <div
          className="h-full bg-primary transition-all duration-700 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        This can take up to a minute. You can leave this screen open.
      </p>
    </div>
  );
}
