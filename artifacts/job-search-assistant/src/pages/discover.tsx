import { useState } from "react";
import { useLocation } from "wouter";
import {
  useDiscoverSettings,
  useSaveDiscoverSettings,
  useDiscoverSearch,
  useDismissDiscover,
  useExtractJob,
  useCreateJob,
} from "@/hooks/use-api";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Search,
  Loader2,
  SlidersHorizontal,
  ChevronDown,
  AlertTriangle,
  Info,
  Compass,
} from "lucide-react";
import { toast } from "sonner";
import { SettingsEditor } from "@/components/discover/SettingsEditor";
import { ResultCard } from "@/components/discover/ResultCard";
import { AddJobDialog, type JobSeed } from "@/components/jobs/AddJobDialog";
import { AiProgress } from "@/components/ui/ai-progress";
import type { DiscoverResult, DiscoverSearchResponse } from "@/lib/api";

const SEARCH_STAGES = [
  "Searching career sites and job boards…",
  "Gathering postings…",
  "Screening each against your parameters…",
  "Ranking the best matches…",
  "Finishing up…",
];

export default function Discover() {
  const [, navigate] = useLocation();

  const { data: settings, isLoading: settingsLoading } = useDiscoverSettings();
  const saveSettings = useSaveDiscoverSettings();
  const search = useDiscoverSearch();
  const dismiss = useDismissDiscover();
  const extract = useExtractJob();
  const createJob = useCreateJob();

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [response, setResponse] = useState<DiscoverSearchResponse | null>(null);
  const [results, setResults] = useState<DiscoverResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [savedUrls, setSavedUrls] = useState<Set<string>>(new Set());
  const [savingUrl, setSavingUrl] = useState<string | null>(null);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [seed, setSeed] = useState<JobSeed | null>(null);

  const runSearch = () => {
    setError(null);
    search.mutate(undefined, {
      onSuccess: (res) => {
        setResponse(res);
        setResults(res.results);
        setSavedUrls(new Set());
      },
      onError: (err) => setError(err.message),
    });
  };

  const handleSaveSettings = (next: Parameters<typeof saveSettings.mutate>[0]) => {
    saveSettings.mutate(next, {
      onSuccess: () => toast.success("Search parameters saved"),
      onError: (err) => toast.error("Could not save", { description: err.message }),
    });
  };

  const handleTailor = (r: DiscoverResult) => {
    setSeed({
      url: r.url,
      title: r.title,
      company: r.company,
      location: r.location,
      work_arrangement: r.work_arrangement,
    });
    setDialogOpen(true);
  };

  const handleSave = (r: DiscoverResult) => {
    setSavingUrl(r.url);
    const finish = () => setSavingUrl(null);
    // Try to fetch the posting so the saved job is tailoring-ready; if the
    // fetch is blocked we still save the metadata we already have.
    extract.mutate(
      { url: r.url },
      {
        onSuccess: (ext) => {
          const base = {
            title: (ext.fetch_failed ? r.title : ext.title) || r.title || "Untitled role",
            company: (ext.fetch_failed ? r.company : ext.company) || r.company || undefined,
            location: (ext.fetch_failed ? r.location : ext.location) || r.location || undefined,
            work_arrangement: (ext.fetch_failed ? r.work_arrangement : ext.work_arrangement) || r.work_arrangement,
            source_url: r.url,
            posting_text: ext.fetch_failed ? undefined : ext.posting_text,
          };
          createJob.mutate(base, {
            onSuccess: () => {
              setSavedUrls((prev) => new Set(prev).add(r.url));
              toast.success("Saved to Jobs", {
                description: ext.fetch_failed
                  ? "Couldn't fetch the posting text — add it later to tailor."
                  : undefined,
              });
              finish();
            },
            onError: (err) => {
              toast.error("Could not save", { description: err.message });
              finish();
            },
          });
        },
        onError: (err) => {
          toast.error("Could not save", { description: err.message });
          finish();
        },
      },
    );
  };

  const handleDismiss = (r: DiscoverResult) => {
    setResults((prev) => prev.filter((x) => x.url !== r.url));
    dismiss.mutate(r.url, {
      onError: (err) => toast.error("Couldn't record dismissal", { description: err.message }),
    });
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div>
        <h1 className="text-3xl font-serif font-semibold text-foreground tracking-tight">Discover</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Search the web for roles that fit your parameters.
        </p>
      </div>

      {/* Search + settings toggle */}
      <div className="rounded-2xl border border-border bg-card p-5 shadow-sm space-y-4">
        <div className="flex items-center gap-2">
          <Button
            className="h-12 flex-1 rounded-xl text-base"
            onClick={runSearch}
            disabled={search.isPending || settingsLoading}
          >
            {search.isPending ? (
              <>
                <Loader2 className="w-5 h-5 mr-2 animate-spin" /> Searching…
              </>
            ) : (
              <>
                <Search className="w-5 h-5 mr-2" /> Search now
              </>
            )}
          </Button>
          <Button
            variant="outline"
            className="h-12 rounded-xl"
            onClick={() => setSettingsOpen((v) => !v)}
          >
            <SlidersHorizontal className="w-4 h-4 sm:mr-2" />
            <span className="hidden sm:inline">Parameters</span>
            <ChevronDown className={`w-4 h-4 ml-1 transition-transform ${settingsOpen ? "rotate-180" : ""}`} />
          </Button>
        </div>

        <div className="flex items-start gap-2 text-xs text-muted-foreground">
          <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span>
            Results are indicative — web search and AI screening won't catch every listing, and
            some matches may be off. Always open the original posting to confirm.
          </span>
        </div>

        {settingsOpen && (
          <div className="pt-4 border-t border-border">
            {settingsLoading || !settings ? (
              <div className="space-y-3">
                <Skeleton className="h-10 w-full rounded-lg" />
                <Skeleton className="h-10 w-full rounded-lg" />
                <Skeleton className="h-10 w-2/3 rounded-lg" />
              </div>
            ) : (
              <SettingsEditor
                settings={settings}
                saving={saveSettings.isPending}
                onSave={handleSaveSettings}
              />
            )}
          </div>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 space-y-3">
          <div className="flex items-start gap-2 text-sm text-destructive">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
          <Button variant="outline" size="sm" onClick={runSearch} className="rounded-lg">
            Try again
          </Button>
        </div>
      )}

      {/* Results */}
      {search.isPending ? (
        <div className="space-y-4">
          <AiProgress stages={SEARCH_STAGES} />
          {[1, 2].map((i) => (
            <Skeleton key={i} className="h-40 w-full rounded-2xl" />
          ))}
        </div>
      ) : response ? (
        results.length > 0 ? (
          <div className="space-y-4">
            <p className="text-xs text-muted-foreground">
              {results.length} shown · screened {response.counts.screened} of {response.counts.raw} raw hits.
            </p>
            {results.map((r) => (
              <ResultCard
                key={r.url}
                result={r}
                saved={savedUrls.has(r.url)}
                saving={savingUrl === r.url}
                onTailor={() => handleTailor(r)}
                onSave={() => handleSave(r)}
                onDismiss={() => handleDismiss(r)}
              />
            ))}
          </div>
        ) : (
          <div className="text-center py-16 px-4 rounded-2xl border-2 border-dashed border-border bg-card/50">
            <div className="w-14 h-14 bg-primary/10 text-primary rounded-2xl flex items-center justify-center mx-auto mb-4">
              <Compass className="w-7 h-7" />
            </div>
            <h3 className="text-lg font-semibold mb-1">No matching roles this time</h3>
            <p className="text-muted-foreground text-sm max-w-md mx-auto">
              Nothing cleared the filters. Try broadening your role titles or loosening the
              parameters, then search again.
            </p>
          </div>
        )
      ) : (
        <div className="text-center py-16 px-4 rounded-2xl border-2 border-dashed border-border bg-card/50">
          <div className="w-14 h-14 bg-primary/10 text-primary rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Search className="w-7 h-7" />
          </div>
          <h3 className="text-lg font-semibold mb-1">Ready when you are</h3>
          <p className="text-muted-foreground text-sm max-w-md mx-auto">
            Hit <b>Search now</b> to sweep company career pages and job boards for roles that match
            your parameters. Adjust the parameters first if you like.
          </p>
        </div>
      )}

      {/* Tailor path reuses the Add-a-job dialog (fetch → paste fallback). */}
      <AddJobDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        seed={seed}
        onCreated={(id) => navigate(`/jobs/${id}`)}
      />
    </div>
  );
}
