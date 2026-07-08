import { useMemo, useState } from "react";
import { useJobs } from "@/hooks/use-api";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Plus,
  BriefcaseBusiness,
  Link as LinkIcon,
  Building2,
  Calendar,
  FileText,
  MapPin,
  Target,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { format } from "date-fns";
import { AddJobDialog } from "@/components/jobs/AddJobDialog";
import type { JobStatus } from "@/lib/api";

const statusColors: Record<JobStatus, string> = {
  New: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  Tailoring: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  Ready: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300",
  Applied: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
  "Not Applying": "bg-slate-100 text-slate-600 dark:bg-slate-800/50 dark:text-slate-400",
};

const arrangementLabels: Record<string, string> = {
  office: "Office",
  hybrid: "Hybrid",
  remote: "Remote",
};

/** Colour the fit pill by score: strong (green) / decent (amber) / weak (rose). */
function fitPillClass(score: number): string {
  if (score >= 8) return "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300";
  if (score >= 6) return "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300";
  return "bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-300";
}

const STATUS_ORDER: JobStatus[] = ["New", "Tailoring", "Ready", "Applied", "Not Applying"];

const statusDot: Record<JobStatus, string> = {
  New: "bg-blue-500",
  Tailoring: "bg-amber-500",
  Ready: "bg-emerald-500",
  Applied: "bg-purple-500",
  "Not Applying": "bg-slate-400",
};

type FitGroup = "strong" | "look" | "weak" | "unscored";

/** Fit buckets for the filter cards. `match` decides which bucket a job falls in. */
const FIT_GROUPS: {
  key: FitGroup;
  label: string;
  range: string;
  dot: string;
  match: (score: number | null | undefined) => boolean;
}[] = [
  { key: "strong", label: "Strong fit", range: "8–10", dot: "bg-emerald-500", match: (s) => typeof s === "number" && s >= 8 },
  { key: "look", label: "Worth a look", range: "6–7", dot: "bg-amber-500", match: (s) => typeof s === "number" && s >= 6 && s < 8 },
  { key: "weak", label: "Weak fit", range: "1–5", dot: "bg-rose-500", match: (s) => typeof s === "number" && s >= 1 && s < 6 },
  { key: "unscored", label: "Not scored", range: "—", dot: "bg-slate-400", match: (s) => !(typeof s === "number" && s > 0) },
];

/** A clickable count card used for the status + fit filters. */
function FilterCard({
  label,
  sublabel,
  count,
  dot,
  active,
  onClick,
}: {
  label: string;
  sublabel?: string;
  count: number;
  dot: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`flex items-center gap-2.5 rounded-xl border px-3 py-2 text-left transition-all ${
        active
          ? "border-primary bg-primary/5 ring-1 ring-primary/40"
          : "border-border bg-card hover:border-primary/30"
      }`}
    >
      <span className="text-xl font-semibold tabular-nums leading-none">{count}</span>
      <span className="flex flex-col">
        <span className="flex items-center gap-1.5 text-xs font-medium leading-tight">
          <span className={`inline-block w-2 h-2 rounded-full ${dot}`} />
          {label}
        </span>
        {sublabel && <span className="text-[10px] text-muted-foreground leading-tight">{sublabel}</span>}
      </span>
    </button>
  );
}

export default function Jobs() {
  const { data: jobs, isLoading } = useJobs();
  const [, navigate] = useLocation();
  const [open, setOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState<JobStatus | null>(null);
  const [fitFilter, setFitFilter] = useState<FitGroup | null>(null);

  const statusCounts = useMemo(() => {
    const m = Object.fromEntries(STATUS_ORDER.map((s) => [s, 0])) as Record<JobStatus, number>;
    (jobs ?? []).forEach((j) => {
      if (m[j.status] !== undefined) m[j.status] += 1;
    });
    return m;
  }, [jobs]);

  const fitCounts = useMemo(() => {
    const m = Object.fromEntries(FIT_GROUPS.map((g) => [g.key, 0])) as Record<FitGroup, number>;
    (jobs ?? []).forEach((j) => {
      const g = FIT_GROUPS.find((g) => g.match(j.fit_score));
      if (g) m[g.key] += 1;
    });
    return m;
  }, [jobs]);

  const filtered = useMemo(
    () =>
      (jobs ?? []).filter(
        (j) =>
          (!statusFilter || j.status === statusFilter) &&
          (!fitFilter || FIT_GROUPS.find((g) => g.key === fitFilter)!.match(j.fit_score)),
      ),
    [jobs, statusFilter, fitFilter],
  );

  const hasFilter = statusFilter !== null || fitFilter !== null;
  const clearFilters = () => {
    setStatusFilter(null);
    setFitFilter(null);
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-serif font-semibold text-foreground tracking-tight">
            Jobs
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Organise and track your active applications.
          </p>
        </div>

        <Button
          size="lg"
          className="rounded-xl shadow-sm hidden sm:flex"
          onClick={() => setOpen(true)}
        >
          <Plus className="w-4 h-4 mr-2" /> Add job
        </Button>
        <Button
          size="icon"
          className="rounded-xl shadow-sm sm:hidden w-12 h-12"
          onClick={() => setOpen(true)}
        >
          <Plus className="w-5 h-5" />
        </Button>
      </div>

      <AddJobDialog
        open={open}
        onOpenChange={setOpen}
        onCreated={(id) => navigate(`/jobs/${id}`)}
      />

      {isLoading ? (
        <div className="grid gap-4">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24 w-full rounded-2xl" />
          ))}
        </div>
      ) : jobs?.length === 0 ? (
        <div className="text-center py-20 px-4 rounded-3xl border-2 border-dashed border-border bg-card/50">
          <div className="w-16 h-16 bg-primary/10 text-primary rounded-2xl flex items-center justify-center mx-auto mb-4">
            <BriefcaseBusiness className="w-8 h-8" />
          </div>
          <h3 className="text-xl font-semibold mb-2">No jobs tracked yet</h3>
          <p className="text-muted-foreground mb-6 max-w-md mx-auto">
            Start building your war room by adding jobs you're interested in.
          </p>
          <Button onClick={() => setOpen(true)} className="rounded-xl">
            Add your first job
          </Button>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Filter cards — counts by status and by fit group; click to filter. */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Filter
              </p>
              {hasFilter && (
                <button
                  type="button"
                  onClick={clearFilters}
                  className="text-xs text-primary hover:underline"
                >
                  Clear filters
                </button>
              )}
            </div>

            <div className="space-y-2">
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70">
                Status
              </p>
              <div className="flex flex-wrap gap-2">
                {STATUS_ORDER.filter((s) => statusCounts[s] > 0).map((s) => (
                  <FilterCard
                    key={s}
                    label={s}
                    count={statusCounts[s]}
                    dot={statusDot[s]}
                    active={statusFilter === s}
                    onClick={() => setStatusFilter((f) => (f === s ? null : s))}
                  />
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70">
                Fit
              </p>
              <div className="flex flex-wrap gap-2">
                {FIT_GROUPS.filter((g) => fitCounts[g.key] > 0).map((g) => (
                  <FilterCard
                    key={g.key}
                    label={g.label}
                    sublabel={g.range}
                    count={fitCounts[g.key]}
                    dot={g.dot}
                    active={fitFilter === g.key}
                    onClick={() => setFitFilter((f) => (f === g.key ? null : g.key))}
                  />
                ))}
              </div>
            </div>

            {hasFilter && (
              <p className="text-xs text-muted-foreground">
                Showing {filtered.length} of {jobs?.length}
              </p>
            )}
          </div>

          {filtered.length === 0 ? (
            <div className="text-center py-14 px-4 rounded-2xl border border-dashed border-border bg-card/50">
              <p className="text-muted-foreground mb-3">No jobs match this filter.</p>
              <Button variant="outline" onClick={clearFilters} className="rounded-xl">
                Clear filters
              </Button>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
              {filtered.map((job, index) => (
            <Link key={job.id} href={`/jobs/${job.id}`}>
              <div
                className="group block p-5 rounded-2xl border border-border bg-card hover:border-primary/30 hover:shadow-md transition-all cursor-pointer animate-in fade-in slide-in-from-bottom-4"
                style={{ animationDelay: `${index * 40}ms`, animationFillMode: "both" }}
              >
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                  <div className="space-y-1 min-w-0">
                    <h3 className="text-lg font-medium group-hover:text-primary transition-colors truncate">
                      {job.title}
                    </h3>

                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                      {job.company && (
                        <span className="flex items-center">
                          <Building2 className="w-4 h-4 mr-1.5" />
                          {job.company}
                        </span>
                      )}
                      {job.location && (
                        <span className="flex items-center">
                          <MapPin className="w-4 h-4 mr-1.5" />
                          {job.location}
                          {job.work_arrangement && arrangementLabels[job.work_arrangement]
                            ? ` · ${arrangementLabels[job.work_arrangement]}`
                            : ""}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-4 mt-3 pt-3 border-t border-border/50 text-xs text-muted-foreground">
                      <span className="flex items-center">
                        <Calendar className="w-3.5 h-3.5 mr-1" />
                        Added {format(new Date(job.created_at), "MMM d")}
                      </span>
                      {job.source_url && (
                        <span className="flex items-center">
                          <LinkIcon className="w-3.5 h-3.5 mr-1" /> URL
                        </span>
                      )}
                      {job.posting_text && (
                        <span className="flex items-center">
                          <FileText className="w-3.5 h-3.5 mr-1" /> Description
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="shrink-0 flex flex-row-reverse sm:flex-col items-end gap-2">
                    <Badge
                      variant="secondary"
                      className={`${statusColors[job.status]} border-0 font-medium px-3 py-1 text-xs rounded-full`}
                    >
                      {job.status}
                    </Badge>
                    {typeof job.fit_score === "number" && job.fit_score > 0 && (
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${fitPillClass(job.fit_score)}`}
                        title={job.fit_note ?? undefined}
                      >
                        <Target className="w-3.5 h-3.5" /> Fit {job.fit_score}/10
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </Link>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
