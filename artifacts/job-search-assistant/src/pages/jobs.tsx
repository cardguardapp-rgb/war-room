import React, { useState } from "react";
import { useJobs, useCreateJob } from "@/hooks/use-api";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Plus, BriefcaseBusiness, Link as LinkIcon, Building2, Calendar, FileText } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { format } from "date-fns";
import { toast } from "sonner";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const statusColors = {
  New: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  Tailoring: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  Ready: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300",
  Applied: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
};

export default function Jobs() {
  const { data: jobs, isLoading } = useJobs();
  const [open, setOpen] = useState(false);
  const createJob = useCreateJob();
  
  const [title, setTitle] = useState("");
  const [company, setCompany] = useState("");
  const [url, setUrl] = useState("");
  const [postingText, setPostingText] = useState("");

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    createJob.mutate(
      { title, company, source_url: url, posting_text: postingText },
      {
        onSuccess: () => {
          setOpen(false);
          setTitle("");
          setCompany("");
          setUrl("");
          setPostingText("");
          toast.success("Job added successfully");
        },
        onError: (err) => {
          toast.error("Failed to add job", { description: err.message });
        }
      }
    );
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-serif font-semibold text-foreground tracking-tight">Jobs</h1>
          <p className="text-muted-foreground mt-1 text-sm">Organise and track your active applications.</p>
        </div>
        
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="lg" className="rounded-xl shadow-sm hidden sm:flex">
              <Plus className="w-4 h-4 mr-2" />
              Add Job
            </Button>
          </DialogTrigger>
          <DialogTrigger asChild>
            <Button size="icon" className="rounded-xl shadow-sm sm:hidden w-12 h-12">
              <Plus className="w-5 h-5" />
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[500px] p-0 overflow-hidden rounded-2xl">
            <div className="p-6 pb-0">
              <DialogHeader>
                <DialogTitle className="text-2xl font-serif">Add a new job</DialogTitle>
              </DialogHeader>
            </div>
            
            <Tabs defaultValue="url" className="w-full mt-4">
              <div className="px-6">
                <TabsList className="grid w-full grid-cols-2 p-1 bg-muted/50 rounded-lg">
                  <TabsTrigger value="url" className="rounded-md">From URL</TabsTrigger>
                  <TabsTrigger value="text" className="rounded-md">Paste Text</TabsTrigger>
                </TabsList>
              </div>

              <form onSubmit={handleCreate} className="p-6 pt-4 space-y-6">
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="title">Job Title <span className="text-destructive">*</span></Label>
                    <Input 
                      id="title" 
                      placeholder="e.g. Senior Frontend Engineer" 
                      value={title} 
                      onChange={e => setTitle(e.target.value)}
                      className="h-12 bg-card"
                    />
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="company">Company</Label>
                    <Input 
                      id="company" 
                      placeholder="e.g. Acme Corp" 
                      value={company} 
                      onChange={e => setCompany(e.target.value)}
                      className="h-12 bg-card"
                    />
                  </div>

                  <TabsContent value="url" className="m-0 space-y-2">
                    <Label htmlFor="url">Source URL</Label>
                    <Input 
                      id="url" 
                      type="url"
                      placeholder="https://..." 
                      value={url} 
                      onChange={e => setUrl(e.target.value)}
                      className="h-12 bg-card"
                    />
                  </TabsContent>

                  <TabsContent value="text" className="m-0 space-y-2">
                    <Label htmlFor="posting">Posting Text</Label>
                    <Textarea 
                      id="posting" 
                      placeholder="Paste the full job description here..." 
                      className="min-h-[150px] resize-none bg-card"
                      value={postingText}
                      onChange={e => setPostingText(e.target.value)}
                    />
                  </TabsContent>
                </div>
                
                <DialogFooter className="gap-2 sm:gap-0 pt-2 border-t border-border mt-6">
                  <Button type="button" variant="ghost" onClick={() => setOpen(false)} className="h-12">Cancel</Button>
                  <Button type="submit" disabled={!title.trim() || createJob.isPending} className="h-12 px-8">
                    {createJob.isPending ? "Adding..." : "Add Job"}
                  </Button>
                </DialogFooter>
              </form>
            </Tabs>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <div className="grid gap-4">
          {[1, 2, 3].map(i => (
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
            Start building your war room by adding jobs you're interested in applying for.
          </p>
          <Button onClick={() => setOpen(true)} className="rounded-xl">Add your first job</Button>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
          {jobs?.map((job, index) => (
            <Link key={job.id} href={`/jobs/${job.id}`}>
              <div 
                className="group block p-5 rounded-2xl border border-border bg-card hover:border-primary/30 hover:shadow-md transition-all cursor-pointer animate-in fade-in slide-in-from-bottom-4"
                style={{ animationDelay: `${index * 50}ms`, animationFillMode: 'both' }}
              >
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                  <div className="space-y-1">
                    <h3 className="text-lg font-medium group-hover:text-primary transition-colors">{job.title}</h3>
                    
                    {job.company && (
                      <div className="flex items-center text-sm text-muted-foreground">
                        <Building2 className="w-4 h-4 mr-1.5" />
                        {job.company}
                      </div>
                    )}
                    
                    <div className="flex items-center gap-4 mt-3 pt-3 border-t border-border/50 text-xs text-muted-foreground">
                      <div className="flex items-center">
                        <Calendar className="w-3.5 h-3.5 mr-1" />
                        Added {format(new Date(job.created_at), "MMM d")}
                      </div>
                      {job.source_url && (
                        <div className="flex items-center">
                          <LinkIcon className="w-3.5 h-3.5 mr-1" />
                          Has URL
                        </div>
                      )}
                      {job.posting_text && (
                        <div className="flex items-center">
                          <FileText className="w-3.5 h-3.5 mr-1" />
                          Has description
                        </div>
                      )}
                    </div>
                  </div>
                  
                  <div className="shrink-0">
                    <Badge variant="secondary" className={`${statusColors[job.status]} border-0 font-medium px-3 py-1 text-xs rounded-full`}>
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