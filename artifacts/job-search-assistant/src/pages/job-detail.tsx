import { useState } from "react";
import { useLocation, useParams } from "wouter";
import { useJob, useUpdateJob, useDeleteJob, useDocuments } from "@/hooks/use-api";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import {
  ChevronLeft,
  Building2,
  Link as LinkIcon,
  Trash2,
  FileText,
  Download,
  MoreVertical,
  MapPin,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { format } from "date-fns";
import { toast } from "sonner";
import { api, type Document, type JobStatus } from "@/lib/api";
import { TailorFlow } from "@/components/jobs/TailorFlow";
import { CoverLetterFlow } from "@/components/jobs/CoverLetterFlow";
import { AppQuestions } from "@/components/jobs/AppQuestions";
import { CopyButton } from "@/components/jobs/CopyButton";

const statusColors: Record<JobStatus, string> = {
  New: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  Tailoring: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  Ready: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300",
  Applied: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
};

const arrangementLabels: Record<string, string> = { office: "Office", hybrid: "Hybrid", remote: "Remote" };

const docTypeLabels: Record<Document["type"], string> = {
  resume: "Tailored resume",
  cover_letter: "Cover letter",
  cover_letter_plain: "Cover letter (plain)",
  cover_note: "Cover note",
};

function contentText(doc: Document): string {
  const c = typeof doc.content_json === "string" ? safeParse(doc.content_json) : doc.content_json;
  return c && typeof c === "object" && typeof c.text === "string" ? c.text : "";
}
function safeParse(s: string): any {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

export default function JobDetail() {
  const [, setLocation] = useLocation();
  const params = useParams();
  const jobId = parseInt(params.id || "0", 10);

  const { data: job, isLoading: jobLoading } = useJob(jobId);
  const { data: documents } = useDocuments(jobId);

  const updateJob = useUpdateJob();
  const deleteJob = useDeleteJob();

  const [deleteOpen, setDeleteOpen] = useState(false);

  // Quick actions surfaced in the mobile bottom bar (one-handed reach).
  const resumeDoc = documents?.find((d) => d.type === "resume");
  const coverDoc = documents?.find((d) => d.type === "cover_letter");
  const noteDoc = documents?.find((d) => d.type === "cover_note");
  const hasQuickActions = !!(resumeDoc || coverDoc || noteDoc);

  if (jobLoading) {
    return (
      <div className="space-y-6 animate-in fade-in">
        <div className="flex items-center gap-4">
          <Skeleton className="w-10 h-10 rounded-full" />
          <Skeleton className="h-8 w-64 rounded-lg" />
        </div>
        <Skeleton className="h-32 w-full rounded-2xl" />
        <Skeleton className="h-64 w-full rounded-2xl" />
      </div>
    );
  }

  if (!job) {
    return (
      <div className="text-center py-20">
        <h2 className="text-2xl font-serif font-semibold">Job not found</h2>
        <Button variant="link" onClick={() => setLocation("/jobs")} className="mt-4">
          <ChevronLeft className="w-4 h-4 mr-2" /> Back to jobs
        </Button>
      </div>
    );
  }

  const handleStatusChange = (status: string) => {
    updateJob.mutate(
      { id: jobId, data: { status: status as JobStatus } },
      { onSuccess: () => toast.success("Status updated") },
    );
  };

  const handleDelete = () => {
    deleteJob.mutate(jobId, {
      onSuccess: () => {
        toast.success("Job removed");
        setLocation("/jobs");
      },
    });
  };

  return (
    <div className={`space-y-8 ${hasQuickActions ? "pb-28" : "pb-10"} md:pb-10 animate-in fade-in duration-500`}>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div className="min-w-0">
          <Button variant="ghost" size="sm" className="-ml-3 mb-2 text-muted-foreground" onClick={() => setLocation("/jobs")}>
            <ChevronLeft className="w-4 h-4 mr-1" /> Back
          </Button>
          <h1 className="text-3xl font-serif font-semibold text-foreground tracking-tight">{job.title}</h1>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-sm text-muted-foreground">
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
                {job.work_arrangement && arrangementLabels[job.work_arrangement] ? ` · ${arrangementLabels[job.work_arrangement]}` : ""}
              </span>
            )}
            <span>Added {format(new Date(job.created_at), "MMMM d, yyyy")}</span>
            {job.source_url && (
              <a href={job.source_url} target="_blank" rel="noreferrer" className="flex items-center text-primary hover:underline">
                <LinkIcon className="w-4 h-4 mr-1.5" /> Original posting
              </a>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Select value={job.status} onValueChange={handleStatusChange}>
            <SelectTrigger className={`w-[140px] border-0 h-10 ${statusColors[job.status]}`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="New">New</SelectItem>
              <SelectItem value="Tailoring">Tailoring</SelectItem>
              <SelectItem value="Ready">Ready</SelectItem>
              <SelectItem value="Applied">Applied</SelectItem>
            </SelectContent>
          </Select>

          <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" className="h-11 w-11 md:h-10 md:w-10 shrink-0">
                  <MoreVertical className="w-4 h-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DialogTrigger asChild>
                  <DropdownMenuItem className="text-destructive focus:text-destructive cursor-pointer">
                    <Trash2 className="w-4 h-4 mr-2" /> Delete job
                  </DropdownMenuItem>
                </DialogTrigger>
              </DropdownMenuContent>
            </DropdownMenu>

            <DialogContent className="sm:max-w-[425px]">
              <DialogHeader>
                <DialogTitle>Delete job</DialogTitle>
                <DialogDescription>
                  Remove this job from your war room? This also deletes its tailored documents and cannot be undone.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter className="mt-4">
                <Button variant="ghost" onClick={() => setDeleteOpen(false)}>Cancel</Button>
                <Button variant="destructive" onClick={handleDelete} disabled={deleteJob.isPending}>
                  {deleteJob.isPending ? "Deleting..." : "Delete"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* AI flows */}
      <TailorFlow job={job} />
      <CoverLetterFlow job={job} />
      <AppQuestions job={job} />

      {/* Description + documents */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2">
          <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
            <h3 className="font-semibold text-lg mb-4 flex items-center">
              <FileText className="w-5 h-5 mr-2 text-primary" /> Job description
            </h3>
            {job.posting_text ? (
              <div className="whitespace-pre-wrap break-words text-sm text-muted-foreground max-h-[420px] overflow-y-auto">
                {job.posting_text}
              </div>
            ) : (
              <div className="text-center py-10 bg-muted/30 rounded-xl">
                <p className="text-muted-foreground italic">No posting text provided.</p>
              </div>
            )}
          </div>
        </div>

        <div>
          <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
            <h3 className="font-semibold text-lg mb-4">Documents</h3>
            {!documents || documents.length === 0 ? (
              <div className="text-center py-8 border border-dashed border-border rounded-xl bg-muted/20">
                <p className="text-sm text-muted-foreground">
                  Approved resumes and cover letters appear here.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {documents.map((doc) => {
                  const downloadable = doc.type === "resume" || doc.type === "cover_letter";
                  const copyable = doc.type === "cover_letter_plain" || doc.type === "cover_note";
                  return (
                    <div key={doc.id} className="p-3 rounded-xl border border-border bg-background space-y-2">
                      <div className="flex items-center gap-3">
                        <div className="p-2 bg-primary/10 text-primary rounded-lg shrink-0">
                          <FileText className="w-4 h-4" />
                        </div>
                        <div className="truncate">
                          <p className="text-sm font-medium truncate">{docTypeLabels[doc.type]}</p>
                          <p className="text-xs text-muted-foreground">{format(new Date(doc.created_at), "MMM d")}</p>
                        </div>
                      </div>
                      {downloadable && (
                        <div className="flex gap-2">
                          <Button variant="outline" size="sm" asChild className="rounded-lg flex-1">
                            <a href={api.documents.getDownloadUrl(doc.id, "docx")}>
                              <Download className="w-4 h-4 mr-1.5" /> .docx
                            </a>
                          </Button>
                          <Button variant="outline" size="sm" asChild className="rounded-lg flex-1">
                            <a href={api.documents.getDownloadUrl(doc.id, "pdf")}>
                              <Download className="w-4 h-4 mr-1.5" /> PDF
                            </a>
                          </Button>
                        </div>
                      )}
                      {copyable && <CopyButton text={contentText(doc)} label="Copy text" className="rounded-lg w-full" />}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Mobile bottom action bar — one-handed access to the key outputs. */}
      {hasQuickActions && (
        <div className="md:hidden fixed inset-x-0 z-30 bottom-[calc(4rem+env(safe-area-inset-bottom))] px-3">
          <div className="mx-auto max-w-4xl flex items-center gap-2 overflow-x-auto rounded-2xl border border-border bg-card/95 backdrop-blur shadow-lg p-2">
            {resumeDoc && (
              <>
                <Button size="sm" variant="outline" asChild className="rounded-lg shrink-0">
                  <a href={api.documents.getDownloadUrl(resumeDoc.id, "docx")}>
                    <Download className="w-4 h-4 mr-1.5" /> Résumé
                  </a>
                </Button>
                <Button size="sm" variant="outline" asChild className="rounded-lg shrink-0">
                  <a href={api.documents.getDownloadUrl(resumeDoc.id, "pdf")}>PDF</a>
                </Button>
              </>
            )}
            {coverDoc && (
              <Button size="sm" variant="outline" asChild className="rounded-lg shrink-0">
                <a href={api.documents.getDownloadUrl(coverDoc.id, "docx")}>
                  <Download className="w-4 h-4 mr-1.5" /> Cover letter
                </a>
              </Button>
            )}
            {noteDoc && (
              <CopyButton text={contentText(noteDoc)} label="Note" className="rounded-lg shrink-0" />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
