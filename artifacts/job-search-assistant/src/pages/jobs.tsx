import { useState } from "react";
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
};

const arrangementLabels: Record<string, string> = {
  office: "Office",
  hybrid: "Hybrid",
  remote: "Remote",
};

export default function Jobs() {
  const { data: jobs, isLoading } = useJobs();
  const [, navigate] = useLocation();
  const [open, setOpen] = useState(false);

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
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
          {jobs?.map((job, index) => (
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

                  <div className="shrink-0">
                    <Badge
                      variant="secondary"
                      className={`${statusColors[job.status]} border-0 font-medium px-3 py-1 text-xs rounded-full`}
                    >
                      {job.status}
                    </Badge>
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
