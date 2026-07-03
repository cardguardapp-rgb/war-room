import { useEffect, useRef, useState } from "react";
import { useCreateJob, useExtractJob } from "@/hooks/use-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AlertTriangle, ChevronLeft, Link2, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import type { WorkArrangement } from "@/lib/api";

interface Draft {
  title: string;
  company: string;
  location: string;
  work_arrangement: WorkArrangement;
  posting_text: string;
  source_url: string;
}

const EMPTY: Draft = {
  title: "",
  company: "",
  location: "",
  work_arrangement: "unknown",
  posting_text: "",
  source_url: "",
};

/** Optional pre-fill for the dialog (used by Discover's "Tailor for this role"). */
export interface JobSeed {
  url?: string;
  title?: string;
  company?: string;
  location?: string;
  work_arrangement?: WorkArrangement;
}

export function AddJobDialog({
  open,
  onOpenChange,
  onCreated,
  seed,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated?: (id: number) => void;
  seed?: JobSeed | null;
}) {
  const extract = useExtractJob();
  const createJob = useCreateJob();

  const [step, setStep] = useState<"input" | "review">("input");
  const [tab, setTab] = useState<"url" | "text">("url");
  const [url, setUrl] = useState("");
  const [pasteText, setPasteText] = useState("");
  const [fetchNote, setFetchNote] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const seededRef = useRef(false);

  const reset = () => {
    setStep("input");
    setTab("url");
    setUrl("");
    setPasteText("");
    setFetchNote(null);
    setDraft(EMPTY);
  };

  const close = (v: boolean) => {
    onOpenChange(v);
    if (!v) {
      seededRef.current = false;
      setTimeout(reset, 200);
    }
  };

  // When opened with a seed (Discover → "Tailor for this role"), pre-fill and
  // auto-run extraction. A blocked fetch falls back to the paste tab as usual.
  useEffect(() => {
    if (!open || !seed || seededRef.current) return;
    seededRef.current = true;
    if (seed.url) {
      setTab("url");
      handleExtractUrl(seed.url);
    } else {
      toReview({});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, seed]);

  const toReview = (data: {
    title?: string;
    company?: string;
    location?: string;
    work_arrangement?: WorkArrangement;
    posting_text?: string;
    source_url?: string;
  }) => {
    // Fall back to the seed (e.g. Discover metadata) where extraction is thin.
    setDraft({
      title: data.title || seed?.title || "",
      company: data.company || seed?.company || "",
      location: data.location || seed?.location || "",
      work_arrangement: data.work_arrangement || seed?.work_arrangement || "unknown",
      posting_text: data.posting_text ?? "",
      source_url: data.source_url || seed?.url || "",
    });
    setStep("review");
  };

  const handleExtractUrl = (explicitUrl?: string) => {
    const target = (explicitUrl ?? url).trim();
    if (!target) return;
    if (explicitUrl && explicitUrl !== url) setUrl(explicitUrl);
    setFetchNote(null);
    extract.mutate(
      { url: target },
      {
        onSuccess: (res) => {
          if (res.fetch_failed) {
            setFetchNote(
              res.message ??
                "Couldn't read that page automatically. Paste the posting text instead.",
            );
            setTab("text");
            return;
          }
          toReview(res);
        },
        onError: (err) =>
          toast.error("Extraction failed", { description: err.message }),
      },
    );
  };

  const handleExtractText = () => {
    if (!pasteText.trim()) return;
    extract.mutate(
      { posting_text: pasteText },
      {
        onSuccess: (res) => toReview({ ...res, source_url: url.trim() || undefined }),
        onError: (err) =>
          toast.error("Extraction failed", { description: err.message }),
      },
    );
  };

  const handleSave = () => {
    if (!draft.title.trim()) {
      toast.error("A job title is required");
      return;
    }
    createJob.mutate(
      {
        title: draft.title.trim(),
        company: draft.company.trim() || undefined,
        location: draft.location.trim() || undefined,
        work_arrangement: draft.work_arrangement,
        source_url: draft.source_url.trim() || undefined,
        posting_text: draft.posting_text.trim() || undefined,
      },
      {
        onSuccess: (job) => {
          toast.success("Job added");
          close(false);
          onCreated?.(job.id);
        },
        onError: (err) =>
          toast.error("Failed to add job", { description: err.message }),
      },
    );
  };

  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-[540px] p-0 overflow-hidden rounded-2xl max-h-[90vh] flex flex-col">
        <div className="p-6 pb-0">
          <DialogHeader>
            <DialogTitle className="text-2xl font-serif">
              {step === "input" ? "Add a job" : "Review the job"}
            </DialogTitle>
          </DialogHeader>
        </div>

        {step === "input" ? (
          <Tabs
            value={tab}
            onValueChange={(v) => setTab(v as "url" | "text")}
            className="w-full mt-4"
          >
            <div className="px-6">
              <TabsList className="grid w-full grid-cols-2 p-1 bg-muted/50 rounded-lg">
                <TabsTrigger value="url" className="rounded-md">From URL</TabsTrigger>
                <TabsTrigger value="text" className="rounded-md">Paste text</TabsTrigger>
              </TabsList>
            </div>

            <div className="p-6 pt-4 space-y-4 overflow-y-auto">
              <TabsContent value="url" className="m-0 space-y-3">
                <div className="space-y-2">
                  <Label htmlFor="job-url">Job posting URL</Label>
                  <Input
                    id="job-url"
                    type="url"
                    placeholder="https://…"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    className="h-12 bg-card"
                  />
                  <p className="text-xs text-muted-foreground">
                    We fetch the page, strip the clutter, and pull out the details.
                    Some sites (LinkedIn especially) block this — you can paste
                    instead.
                  </p>
                </div>
                {fetchNote && (
                  <div className="flex items-start gap-2 rounded-xl border border-amber-300/60 bg-amber-50 dark:bg-amber-950/30 p-3 text-sm text-amber-800 dark:text-amber-300">
                    <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                    <span>{fetchNote}</span>
                  </div>
                )}
                <Button
                  className="w-full h-12 rounded-xl"
                  onClick={() => handleExtractUrl()}
                  disabled={!url.trim() || extract.isPending}
                >
                  {extract.isPending ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Reading…
                    </>
                  ) : (
                    <>
                      <Link2 className="w-4 h-4 mr-2" /> Fetch &amp; review
                    </>
                  )}
                </Button>
              </TabsContent>

              <TabsContent value="text" className="m-0 space-y-3">
                <div className="space-y-2">
                  <Label htmlFor="job-text">Posting text</Label>
                  <Textarea
                    id="job-text"
                    placeholder="Paste the full job description here…"
                    className="min-h-[180px] resize-none bg-card"
                    value={pasteText}
                    onChange={(e) => setPasteText(e.target.value)}
                  />
                </div>
                <Button
                  className="w-full h-12 rounded-xl"
                  onClick={handleExtractText}
                  disabled={!pasteText.trim() || extract.isPending}
                >
                  {extract.isPending ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Extracting…
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4 mr-2" /> Extract &amp; review
                    </>
                  )}
                </Button>
              </TabsContent>
            </div>
          </Tabs>
        ) : (
          <div className="p-6 pt-4 space-y-4 overflow-y-auto">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5 sm:col-span-2">
                <Label className="text-xs text-muted-foreground">
                  Job title <span className="text-destructive">*</span>
                </Label>
                <Input value={draft.title} onChange={(e) => set({ title: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Company</Label>
                <Input value={draft.company} onChange={(e) => set({ company: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Location</Label>
                <Input value={draft.location} onChange={(e) => set({ location: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Work arrangement</Label>
                <Select
                  value={draft.work_arrangement}
                  onValueChange={(v) => set({ work_arrangement: v as WorkArrangement })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="office">Office</SelectItem>
                    <SelectItem value="hybrid">Hybrid</SelectItem>
                    <SelectItem value="remote">Remote</SelectItem>
                    <SelectItem value="unknown">Unknown</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">
                Posting text (used for tailoring)
              </Label>
              <Textarea
                value={draft.posting_text}
                onChange={(e) => set({ posting_text: e.target.value })}
                className="min-h-[160px] text-sm"
              />
            </div>
          </div>
        )}

        <div className="flex items-center justify-between gap-2 p-6 pt-4 border-t border-border">
          {step === "review" ? (
            <Button variant="ghost" onClick={() => setStep("input")}>
              <ChevronLeft className="w-4 h-4 mr-1" /> Back
            </Button>
          ) : (
            <Button variant="ghost" onClick={() => close(false)}>
              Cancel
            </Button>
          )}
          {step === "review" && (
            <Button
              onClick={handleSave}
              disabled={!draft.title.trim() || createJob.isPending}
              className="rounded-xl px-8"
            >
              {createJob.isPending ? "Saving…" : "Save job"}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
