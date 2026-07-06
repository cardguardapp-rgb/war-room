import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Building2,
  MapPin,
  ExternalLink,
  Sparkles,
  Bookmark,
  X,
  Loader2,
  CheckCircle2,
  Clock,
} from "lucide-react";
import type { DiscoverResult, MatchVerdict, WorkArrangement } from "@/lib/api";

const arrangementLabels: Record<WorkArrangement, string> = {
  office: "Office",
  hybrid: "Hybrid",
  remote: "Remote",
  unknown: "Arrangement unclear",
};

const verdictStyles: Record<MatchVerdict, string> = {
  yes: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300",
  unsure: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  no: "bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-300",
};

const verdictLabel: Record<MatchVerdict, string> = {
  yes: "match",
  unsure: "unsure",
  no: "no",
};

/** Fit-score colour + one-word read, so the number is glanceable. */
function fitStyle(score: number): { ring: string; text: string; label: string } {
  if (score >= 8)
    return {
      ring: "border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40",
      text: "text-emerald-700 dark:text-emerald-300",
      label: "Strong fit",
    };
  if (score >= 5)
    return {
      ring: "border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40",
      text: "text-amber-700 dark:text-amber-300",
      label: "Worth a look",
    };
  return {
    ring: "border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/40",
    text: "text-rose-700 dark:text-rose-300",
    label: "Weak fit",
  };
}

export function ResultCard({
  result,
  saved,
  saving,
  onTailor,
  onSave,
  onDismiss,
}: {
  result: DiscoverResult;
  saved: boolean;
  saving: boolean;
  onTailor: () => void;
  onSave: () => void;
  onDismiss: () => void;
}) {
  const fit = fitStyle(result.fit_score);
  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-sm space-y-3 animate-in fade-in slide-in-from-bottom-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-medium text-base leading-snug">{result.title || "Untitled role"}</h3>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-sm text-muted-foreground">
            {result.company && (
              <span className="flex items-center">
                <Building2 className="w-4 h-4 mr-1.5" />
                {result.company}
              </span>
            )}
            {result.location && (
              <span className="flex items-center">
                <MapPin className="w-4 h-4 mr-1.5" />
                {result.location}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-start gap-1.5 shrink-0">
          <div
            className={`flex flex-col items-center justify-center rounded-xl border px-2.5 py-1 leading-none ${fit.ring}`}
            title={`Fit ${result.fit_score}/10 — ${fit.label}`}
          >
            <span className={`text-lg font-semibold ${fit.text}`}>
              {result.fit_score}
              <span className="text-xs font-normal opacity-70">/10</span>
            </span>
            <span className={`mt-0.5 text-[10px] font-medium ${fit.text}`}>Fit</span>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-11 w-11 md:h-9 md:w-9 text-muted-foreground hover:text-foreground"
            onClick={onDismiss}
            aria-label="Dismiss"
            title="Dismiss — never show this again"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Badge variant="secondary" className="rounded-full border-0 font-medium">
          {arrangementLabels[result.work_arrangement]}
        </Badge>
        <Badge
          variant="secondary"
          className={`rounded-full border-0 font-medium ${verdictStyles[result.seniority_match]}`}
        >
          Seniority: {verdictLabel[result.seniority_match]}
        </Badge>
        <Badge
          variant="secondary"
          className={`rounded-full border-0 font-medium ${verdictStyles[result.location_match]}`}
        >
          Location: {verdictLabel[result.location_match]}
        </Badge>
      </div>

      {result.fit_note && (
        <p className="text-sm">
          <span className={`font-medium ${fit.text}`}>{fit.label}.</span>{" "}
          <span className="text-muted-foreground">{result.fit_note}</span>
        </p>
      )}

      {result.reason && <p className="text-sm text-muted-foreground">{result.reason}</p>}

      {result.posted && (
        <p className="text-xs text-muted-foreground/80 flex items-center gap-1">
          <Clock className="w-3.5 h-3.5" /> {result.posted}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <Button size="sm" className="rounded-lg" onClick={onTailor}>
          <Sparkles className="w-4 h-4 mr-1.5" /> Tailor for this role
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="rounded-lg"
          onClick={onSave}
          disabled={saving || saved}
        >
          {saving ? (
            <>
              <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> Saving…
            </>
          ) : saved ? (
            <>
              <CheckCircle2 className="w-4 h-4 mr-1.5 text-emerald-500" /> Saved
            </>
          ) : (
            <>
              <Bookmark className="w-4 h-4 mr-1.5" /> Save
            </>
          )}
        </Button>
        <Button size="sm" variant="ghost" asChild className="rounded-lg ml-auto">
          <a href={result.url} target="_blank" rel="noreferrer">
            <ExternalLink className="w-4 h-4 mr-1.5" /> Open listing
          </a>
        </Button>
      </div>
    </div>
  );
}
