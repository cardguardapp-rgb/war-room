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
        <Button
          variant="ghost"
          size="icon"
          className="h-11 w-11 md:h-9 md:w-9 shrink-0 text-muted-foreground hover:text-foreground"
          onClick={onDismiss}
          aria-label="Dismiss"
          title="Dismiss — never show this again"
        >
          <X className="w-4 h-4" />
        </Button>
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

      {result.reason && <p className="text-sm text-muted-foreground">{result.reason}</p>}

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
