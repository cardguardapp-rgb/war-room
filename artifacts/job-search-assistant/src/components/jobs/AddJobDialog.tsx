import { useEffect, useRef, useState } from "react";
import { useCreateJob, useExtractJob, useExtractJobImage } from "@/hooks/use-api";
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
import {
  AlertTriangle,
  ArrowRight,
  ChevronLeft,
  ImageIcon,
  Info,
  Link2,
  Loader2,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import { toast } from "sonner";
import type { WorkArrangement } from "@/lib/api";

interface Draft {
  title: string;
  company: string;
  location: string;
  work_arrangement: WorkArrangement;
  posting_text: string;
  source_url: string;
  summary: string;
  flags: string[];
  fit_score: number;
  fit_note: string;
}

const EMPTY: Draft = {
  title: "",
  company: "",
  location: "",
  work_arrangement: "unknown",
  posting_text: "",
  source_url: "",
  summary: "",
  flags: [],
  fit_score: 0,
  fit_note: "",
};

/**
 * Turn a recruiter's high-level brief (no full JD yet) into `posting_text` the
 * normal tailoring flow can work from. The leading note tells the model to
 * re-emphasise real experience toward the highlighted areas and to ask rather
 * than invent where the brief is thin — never fabricates experience.
 */
function buildBriefPosting(input: {
  title: string;
  company: string;
  location: string;
  info: string;
  highlights: string;
}): string {
  const highlightLines = input.highlights
    .split("\n")
    .map((l) => l.replace(/^[\s\-•*]+/, "").trim())
    .filter(Boolean);
  return [
    "This role does not have a full job description yet — the details below are a",
    "high-level brief (e.g. shared by a recruiter). Tailor the resume to emphasise the",
    "areas noted, drawing only on the candidate's real experience; where the brief is",
    "thin, ask clarifying questions rather than inventing detail.",
    "",
    `Role: ${input.title.trim() || "Not specified"}`,
    `Company: ${input.company.trim() || "Not specified"}`,
    `Location: ${input.location.trim() || "Not specified"}`,
    "",
    "What's known about the role:",
    input.info.trim() || "—",
    "",
    "Areas to emphasise in the resume:",
    highlightLines.length ? highlightLines.map((l) => `- ${l}`).join("\n") : "—",
  ].join("\n");
}

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
  const extractImage = useExtractJobImage();
  const createJob = useCreateJob();

  const [step, setStep] = useState<"input" | "review">("input");
  const [tab, setTab] = useState<"url" | "text" | "image">("url");
  const [url, setUrl] = useState("");
  const [pasteText, setPasteText] = useState("");
  const [images, setImages] = useState<File[]>([]);
  const [fetchNote, setFetchNote] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const seededRef = useRef(false);

  // "I don't have the full job description yet" — build a resume from a
  // recruiter's high-level brief + the areas to emphasise.
  const [briefMode, setBriefMode] = useState(false);
  const [isBrief, setIsBrief] = useState(false);
  const [briefTitle, setBriefTitle] = useState("");
  const [briefCompany, setBriefCompany] = useState("");
  const [briefLocation, setBriefLocation] = useState("");
  const [briefInfo, setBriefInfo] = useState("");
  const [briefHighlights, setBriefHighlights] = useState("");

  const reset = () => {
    setStep("input");
    setTab("url");
    setUrl("");
    setPasteText("");
    setImages([]);
    setFetchNote(null);
    setDraft(EMPTY);
    setBriefMode(false);
    setIsBrief(false);
    setBriefTitle("");
    setBriefCompany("");
    setBriefLocation("");
    setBriefInfo("");
    setBriefHighlights("");
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
    summary?: string;
    flags?: string[];
    fit_score?: number;
    fit_note?: string;
  }) => {
    // Default to a real posting; brief mode re-sets this after calling toReview.
    setIsBrief(false);
    // Fall back to the seed (e.g. Discover metadata) where extraction is thin.
    setDraft({
      title: data.title || seed?.title || "",
      company: data.company || seed?.company || "",
      location: data.location || seed?.location || "",
      work_arrangement: data.work_arrangement || seed?.work_arrangement || "unknown",
      posting_text: data.posting_text ?? "",
      source_url: data.source_url || seed?.url || "",
      summary: (data.summary ?? "").trim(),
      flags: Array.isArray(data.flags) ? data.flags.filter((f) => f && f.trim()) : [],
      fit_score: typeof data.fit_score === "number" ? data.fit_score : 0,
      fit_note: (data.fit_note ?? "").trim(),
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

  const addImages = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const picked = Array.from(files).filter((f) => f.type.startsWith("image/"));
    setImages((prev) => [...prev, ...picked].slice(0, 8));
  };

  const handleBriefContinue = () => {
    if (!briefTitle.trim()) {
      toast.error("A job title is required");
      return;
    }
    const posting = buildBriefPosting({
      title: briefTitle,
      company: briefCompany,
      location: briefLocation,
      info: briefInfo,
      highlights: briefHighlights,
    });
    toReview({
      title: briefTitle.trim(),
      company: briefCompany.trim() || undefined,
      location: briefLocation.trim() || undefined,
      posting_text: posting,
    });
    // Mark this as a brief so we don't auto-run a (misleading) fit score on save.
    setIsBrief(true);
  };

  const handleExtractImages = () => {
    if (images.length === 0) return;
    setFetchNote(null);
    extractImage.mutate(images, {
      onSuccess: (res) => toReview({ ...res, source_url: url.trim() || undefined }),
      onError: (err) => toast.error("Couldn't read the screenshot", { description: err.message }),
    });
  };

  const handleSave = () => {
    if (!draft.title.trim()) {
      toast.error("A job title is required");
      return;
    }
    // Persist the fit assessment with the job so it shows on Job Detail later.
    const hasAssessment =
      draft.fit_score > 0 || !!draft.fit_note || !!draft.summary || draft.flags.length > 0;
    createJob.mutate(
      {
        title: draft.title.trim(),
        company: draft.company.trim() || undefined,
        location: draft.location.trim() || undefined,
        work_arrangement: draft.work_arrangement,
        source_url: draft.source_url.trim() || undefined,
        posting_text: draft.posting_text.trim() || undefined,
        brief: isBrief || undefined,
        assessment: hasAssessment
          ? {
              fit_score: draft.fit_score,
              fit_note: draft.fit_note,
              summary: draft.summary,
              flags: draft.flags,
            }
          : undefined,
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
          <div className="mt-4">
            <div className="px-6">
              <label className="flex items-start gap-3 rounded-xl border border-border bg-card p-3.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={briefMode}
                  onChange={(e) => setBriefMode(e.target.checked)}
                  className="mt-0.5 h-4 w-4 shrink-0 rounded border-border accent-primary"
                />
                <span className="min-w-0">
                  <span className="block text-sm font-medium">
                    I don&apos;t have the full job description yet
                  </span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    For when a recruiter has shared only high-level details. Tell us what
                    you know and the areas to emphasise, and we&apos;ll build a brief you
                    can tailor a resume from.
                  </span>
                </span>
              </label>
            </div>

            {briefMode ? (
              <div className="p-6 pt-4 space-y-4 overflow-y-auto">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label htmlFor="brief-title">
                      Job title <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      id="brief-title"
                      placeholder="e.g. Head of Product"
                      value={briefTitle}
                      onChange={(e) => setBriefTitle(e.target.value)}
                      className="h-12 bg-card"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="brief-company">Company (if known)</Label>
                    <Input
                      id="brief-company"
                      placeholder="Optional"
                      value={briefCompany}
                      onChange={(e) => setBriefCompany(e.target.value)}
                      className="h-12 bg-card"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="brief-location">Location (if known)</Label>
                    <Input
                      id="brief-location"
                      placeholder="Optional"
                      value={briefLocation}
                      onChange={(e) => setBriefLocation(e.target.value)}
                      className="h-12 bg-card"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="brief-info">What you know about the role</Label>
                  <Textarea
                    id="brief-info"
                    placeholder="Whatever the recruiter shared — seniority, team, product area, key responsibilities, must-haves, salary…"
                    className="min-h-[110px] resize-none bg-card"
                    value={briefInfo}
                    onChange={(e) => setBriefInfo(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="brief-highlight">Areas to highlight in your resume</Label>
                  <Textarea
                    id="brief-highlight"
                    placeholder="What should this resume lead with? e.g. scaling product teams, B2B SaaS, stakeholder management. One per line."
                    className="min-h-[90px] resize-none bg-card"
                    value={briefHighlights}
                    onChange={(e) => setBriefHighlights(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    These guide what the resume leads with. We never invent experience —
                    only re-emphasise what&apos;s already in your profile.
                  </p>
                </div>
                <Button
                  className="w-full h-12 rounded-xl"
                  onClick={handleBriefContinue}
                  disabled={!briefTitle.trim()}
                >
                  <ArrowRight className="w-4 h-4 mr-2" /> Continue to review
                </Button>
              </div>
            ) : (
          <Tabs
            value={tab}
            onValueChange={(v) => setTab(v as "url" | "text" | "image")}
            className="w-full mt-4"
          >
            <div className="px-6">
              <TabsList className="grid w-full grid-cols-3 p-1 bg-muted/50 rounded-lg">
                <TabsTrigger value="url" className="rounded-md">From URL</TabsTrigger>
                <TabsTrigger value="text" className="rounded-md">Paste text</TabsTrigger>
                <TabsTrigger value="image" className="rounded-md">Screenshot</TabsTrigger>
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

              <TabsContent value="image" className="m-0 space-y-3">
                <div className="space-y-2">
                  <Label>Screenshot(s) of the posting</Label>
                  <label
                    htmlFor="job-images"
                    className="flex flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-border bg-card px-4 py-8 text-center cursor-pointer hover:border-primary/40 transition-colors"
                  >
                    <Upload className="w-6 h-6 text-muted-foreground" />
                    <span className="text-sm font-medium">Tap to add images</span>
                    <span className="text-xs text-muted-foreground">
                      PNG, JPEG, GIF or WebP · up to 8 · 10MB each
                    </span>
                    <input
                      id="job-images"
                      type="file"
                      accept="image/*"
                      multiple
                      className="hidden"
                      onChange={(e) => {
                        addImages(e.target.files);
                        e.target.value = "";
                      }}
                    />
                  </label>
                  <p className="text-xs text-muted-foreground">
                    Perfect for LinkedIn, where the text can't be copied — screenshot the posting
                    (several shots are fine) and we'll read it. Add them in reading order.
                  </p>
                </div>

                {images.length > 0 && (
                  <ul className="space-y-2">
                    {images.map((file, i) => (
                      <li
                        key={i}
                        className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm"
                      >
                        <ImageIcon className="w-4 h-4 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1 truncate">{file.name}</span>
                        <span className="text-xs text-muted-foreground shrink-0">
                          {(file.size / 1024).toFixed(0)} KB
                        </span>
                        <button
                          type="button"
                          aria-label={`Remove ${file.name}`}
                          onClick={() => setImages((prev) => prev.filter((_, idx) => idx !== i))}
                          className="shrink-0 text-muted-foreground hover:text-destructive"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}

                <Button
                  className="w-full h-12 rounded-xl"
                  onClick={handleExtractImages}
                  disabled={images.length === 0 || extractImage.isPending}
                >
                  {extractImage.isPending ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Reading screenshot…
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
            )}
          </div>
        ) : (
          <div className="p-6 pt-4 space-y-4 overflow-y-auto">
            {draft.fit_score > 0 && (
              <div
                className={`flex items-center gap-3 rounded-xl border p-3.5 ${
                  draft.fit_score >= 8
                    ? "border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40"
                    : draft.fit_score >= 5
                      ? "border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40"
                      : "border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/40"
                }`}
              >
                <div
                  className={`flex flex-col items-center justify-center leading-none shrink-0 ${
                    draft.fit_score >= 8
                      ? "text-emerald-700 dark:text-emerald-300"
                      : draft.fit_score >= 5
                        ? "text-amber-700 dark:text-amber-300"
                        : "text-rose-700 dark:text-rose-300"
                  }`}
                >
                  <span className="text-2xl font-semibold">
                    {draft.fit_score}
                    <span className="text-sm font-normal opacity-70">/10</span>
                  </span>
                  <span className="mt-0.5 text-[10px] font-medium uppercase tracking-wide">Fit</span>
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-medium">
                    {draft.fit_score >= 8
                      ? "Strong fit"
                      : draft.fit_score >= 5
                        ? "Worth a look"
                        : "Weak fit"}
                  </div>
                  {draft.fit_note && (
                    <p className="text-sm text-muted-foreground">{draft.fit_note}</p>
                  )}
                </div>
              </div>
            )}
            {draft.summary && (
              <div className="rounded-xl border border-border bg-muted/40 p-3.5 space-y-1.5">
                <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <Info className="w-3.5 h-3.5" /> What this role is
                </div>
                <p className="text-sm leading-relaxed">{draft.summary}</p>
              </div>
            )}
            {draft.flags.length > 0 && (
              <div className="rounded-xl border border-amber-300/60 bg-amber-50 dark:bg-amber-950/30 p-3.5 space-y-2">
                <div className="flex items-center gap-1.5 text-sm font-medium text-amber-800 dark:text-amber-300">
                  <AlertTriangle className="w-4 h-4" /> Worth checking before you apply
                </div>
                <ul className="space-y-1.5">
                  {draft.flags.map((f, i) => (
                    <li
                      key={i}
                      className="flex items-start gap-2 text-sm text-amber-800 dark:text-amber-300"
                    >
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
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
