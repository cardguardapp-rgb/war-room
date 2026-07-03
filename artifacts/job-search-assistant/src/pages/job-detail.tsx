import React, { useState } from "react";
import { useLocation, useParams } from "wouter";
import { useJob, useUpdateJob, useDeleteJob, useDocuments, useGenerateDocument, useTailorJob } from "@/hooks/use-api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ChevronLeft, Building2, Link as LinkIcon, Trash2, FileText, Sparkles, Download, MoreVertical, Loader2, AlertCircle } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { format } from "date-fns";
import { toast } from "sonner";
import { api } from "@/lib/api";

const statusColors = {
  New: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  Tailoring: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  Ready: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300",
  Applied: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
};

export default function JobDetail() {
  const [, setLocation] = useLocation();
  const params = useParams();
  const jobId = parseInt(params.id || "0", 10);
  
  const { data: job, isLoading: jobLoading } = useJob(jobId);
  const { data: documents, isLoading: docsLoading } = useDocuments(jobId);
  
  const updateJob = useUpdateJob();
  const deleteJob = useDeleteJob();
  const generateDoc = useGenerateDocument();
  const tailorJob = useTailorJob();

  const [deleteOpen, setDeleteOpen] = useState(false);

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
    updateJob.mutate({ id: jobId, data: { status: status as any } }, {
      onSuccess: () => toast.success("Status updated")
    });
  };

  const handleDelete = () => {
    deleteJob.mutate(jobId, {
      onSuccess: () => {
        toast.success("Job removed");
        setLocation("/jobs");
      }
    });
  };

  const handleTailor = () => {
    tailorJob.mutate(jobId, {
      onSuccess: () => {
        // Will never hit this in current stub
      },
      onError: (err) => {
        toast.info("Coming Soon", {
          description: "AI tailoring is currently being built. Check back soon!",
          icon: <Sparkles className="w-4 h-4 text-primary" />
        });
      }
    });
  };

  const handleGenerate = (type: any) => {
    generateDoc.mutate({ jobId, type }, {
      onError: (err) => {
        toast.info("Coming Soon", {
          description: "Document generation is currently being built. Check back soon!",
          icon: <Sparkles className="w-4 h-4 text-primary" />
        });
      }
    });
  };

  return (
    <div className="space-y-8 pb-10 animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div>
          <Button variant="ghost" size="sm" className="-ml-3 mb-2 text-muted-foreground" onClick={() => setLocation("/jobs")}>
            <ChevronLeft className="w-4 h-4 mr-1" /> Back
          </Button>
          <h1 className="text-3xl font-serif font-semibold text-foreground tracking-tight">{job.title}</h1>
          <div className="flex flex-wrap items-center gap-4 mt-2 text-sm text-muted-foreground">
            {job.company && (
              <div className="flex items-center">
                <Building2 className="w-4 h-4 mr-1.5" />
                {job.company}
              </div>
            )}
            <div className="flex items-center">
              Added {format(new Date(job.created_at), "MMMM d, yyyy")}
            </div>
            {job.source_url && (
              <a href={job.source_url} target="_blank" rel="noreferrer" className="flex items-center text-primary hover:underline">
                <LinkIcon className="w-4 h-4 mr-1.5" />
                Original posting
              </a>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
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
                <Button variant="outline" size="icon" className="h-10 w-10 shrink-0">
                  <MoreVertical className="w-4 h-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DialogTrigger asChild>
                  <DropdownMenuItem className="text-destructive focus:text-destructive cursor-pointer">
                    <Trash2 className="w-4 h-4 mr-2" />
                    Delete Job
                  </DropdownMenuItem>
                </DialogTrigger>
              </DropdownMenuContent>
            </DropdownMenu>

            <DialogContent className="sm:max-w-[425px]">
              <DialogHeader>
                <DialogTitle>Delete Job</DialogTitle>
                <DialogDescription>
                  Are you sure you want to remove this job from your war room? This action cannot be undone.
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

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Main Content: Description */}
        <div className="lg:col-span-2 space-y-6">
          <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
            <h3 className="font-semibold text-lg mb-4 flex items-center">
              <FileText className="w-5 h-5 mr-2 text-primary" />
              Job Description
            </h3>
            {job.posting_text ? (
              <div className="prose prose-sm max-w-none dark:prose-invert">
                <div className="whitespace-pre-wrap text-muted-foreground">{job.posting_text}</div>
              </div>
            ) : (
              <div className="text-center py-10 bg-muted/30 rounded-xl">
                <p className="text-muted-foreground italic">No posting text provided.</p>
              </div>
            )}
          </div>
        </div>

        {/* Sidebar: Documents & Actions */}
        <div className="space-y-6">
          {/* AI Tailoring Action */}
          <div className="rounded-2xl border border-primary/20 bg-primary/5 p-6 shadow-sm relative overflow-hidden">
            <div className="absolute top-0 right-0 p-4 opacity-10">
              <Sparkles className="w-16 h-16" />
            </div>
            <h3 className="font-semibold text-lg mb-2 relative z-10 text-primary">Tailor Application</h3>
            <p className="text-sm text-muted-foreground mb-4 relative z-10">
              Generate a custom resume and cover letter optimised for this specific role.
            </p>
            <Button 
              className="w-full rounded-xl" 
              onClick={handleTailor}
              disabled={tailorJob.isPending}
            >
              <Sparkles className="w-4 h-4 mr-2" />
              Start Tailoring
            </Button>
          </div>

          {/* Documents List */}
          <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-lg">Documents</h3>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="rounded-lg">
                    Generate
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  <DropdownMenuItem onClick={() => handleGenerate('resume')}>Resume</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleGenerate('cover_letter')}>Cover Letter</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleGenerate('cover_letter_plain')}>Plain Cover Letter</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleGenerate('cover_note')}>Cover Note</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            {docsLoading ? (
              <div className="space-y-3">
                <Skeleton className="h-12 w-full rounded-lg" />
                <Skeleton className="h-12 w-full rounded-lg" />
              </div>
            ) : documents?.length === 0 ? (
              <div className="text-center py-8 border border-dashed border-border rounded-xl bg-muted/20">
                <AlertCircle className="w-8 h-8 text-muted-foreground mx-auto mb-2 opacity-50" />
                <p className="text-sm text-muted-foreground">No documents generated yet</p>
              </div>
            ) : (
              <div className="space-y-3">
                {documents?.map(doc => (
                  <div key={doc.id} className="flex items-center justify-between p-3 rounded-xl border border-border bg-background hover:border-primary/30 transition-colors">
                    <div className="flex items-center gap-3 overflow-hidden">
                      <div className="p-2 bg-primary/10 text-primary rounded-lg shrink-0">
                        <FileText className="w-4 h-4" />
                      </div>
                      <div className="truncate">
                        <p className="text-sm font-medium truncate capitalize">
                          {doc.type.replace(/_/g, ' ')}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {format(new Date(doc.created_at), "MMM d")}
                        </p>
                      </div>
                    </div>
                    <Button variant="ghost" size="icon" asChild className="shrink-0 text-muted-foreground hover:text-primary">
                      <a href={api.documents.getDownloadUrl(doc.id)} target="_blank" rel="noreferrer">
                        <Download className="w-4 h-4" />
                      </a>
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}