import React, { useRef, useState } from "react";
import {
  useProfile,
  useUpdateProfile,
  useParseResume,
  useConfirmResume,
} from "@/hooks/use-api";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  CheckCircle2,
  Download,
  FileText,
  FileUp,
  Loader2,
  Pencil,
  Archive,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";
import {
  api,
  type ExtraAnswer,
  type ParsedResume,
  type ResumeJson,
  type ResumeSection,
  type StyleMap,
} from "@/lib/api";
import { ResumeReview } from "@/components/profile/ResumeReview";
import { ExtraAnswers } from "@/components/profile/ExtraAnswers";
import { AdditionalContext } from "@/components/profile/AdditionalContext";
import { SECTION_KIND_LABELS } from "@/components/profile/resumeDraft";

const MAX_BYTES = 5 * 1024 * 1024;

interface Draft {
  filename: string;
  sections: ResumeSection[];
  styleMap: StyleMap | null;
  warnings: string[];
  isNew: boolean;
}

export default function Profile() {
  const { data: profile, isLoading } = useProfile();
  const updateProfile = useUpdateProfile();
  const parseResume = useParseResume();
  const confirmResume = useConfirmResume();

  const [draft, setDraft] = useState<Draft | null>(null);
  const [replaceOpen, setReplaceOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const openFilePicker = () => fileInputRef.current?.click();

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file later
    if (!file) return;

    if (!file.name.toLowerCase().endsWith(".docx")) {
      toast.error("Invalid file type", {
        description: "Only .docx files are accepted.",
      });
      return;
    }
    if (file.size > MAX_BYTES) {
      toast.error("File too large", {
        description: "Please keep your resume under 5MB.",
      });
      return;
    }

    parseResume.mutate(file, {
      onSuccess: (result: ParsedResume) => {
        setDraft({
          filename: result.filename,
          sections: result.resume_json.sections,
          styleMap: result.style_map_json,
          warnings: result.warnings,
          isNew: true,
        });
      },
      onError: (err) => {
        toast.error("Couldn't read that file", { description: err.message });
      },
    });
  };

  const startEdit = () => {
    if (!profile?.resume_filename || !profile.resume_json) return;
    setDraft({
      filename: profile.resume_filename,
      sections: profile.resume_json.sections ?? [],
      styleMap: profile.style_map_json,
      warnings: [],
      isNew: false,
    });
  };

  const handleConfirm = () => {
    if (!draft) return;
    const resume_json: ResumeJson = { version: 1, sections: draft.sections };
    confirmResume.mutate(
      {
        filename: draft.filename,
        resume_json,
        style_map_json:
          draft.styleMap ?? {
            version: 1,
            defaults: { fontFamily: null, fontSizePt: null, color: null },
            elements: {} as StyleMap["elements"],
          },
      },
      {
        onSuccess: () => {
          setDraft(null);
          toast.success("Resume saved", {
            description: "Your structured resume is now the source of truth.",
          });
        },
        onError: (err) => {
          toast.error("Couldn't save", { description: err.message });
        },
      },
    );
  };

  const handleSaveAnswers = (items: ExtraAnswer[]) => {
    updateProfile.mutate(
      { extra_answers_json: items },
      {
        onSuccess: () => toast.success("Answers saved"),
        onError: (err) =>
          toast.error("Couldn't save answers", { description: err.message }),
      },
    );
  };

  const handleSaveContext = (text: string) => {
    updateProfile.mutate(
      { extra_context: text },
      {
        onSuccess: () => toast.success("Additional context saved"),
        onError: (err) =>
          toast.error("Couldn't save context", { description: err.message }),
      },
    );
  };

  if (isLoading) {
    return (
      <div className="space-y-8 animate-in fade-in">
        <Skeleton className="h-10 w-48 rounded-lg" />
        <Skeleton className="h-40 w-full rounded-2xl" />
        <Skeleton className="h-64 w-full rounded-2xl" />
      </div>
    );
  }

  // Review / edit mode takes over the whole page.
  if (draft) {
    return (
      <ResumeReview
        sections={draft.sections}
        setSections={(updater) =>
          setDraft((d) => (d ? { ...d, sections: updater(d.sections) } : d))
        }
        styleMap={draft.styleMap}
        warnings={draft.warnings}
        isNew={draft.isNew}
        saving={confirmResume.isPending}
        onConfirm={handleConfirm}
        onCancel={() => setDraft(null)}
      />
    );
  }

  const hasResume = !!profile?.resume_filename;

  return (
    <div className="space-y-8 pb-10 animate-in fade-in duration-500 max-w-3xl">
      <div>
        <h1 className="text-3xl font-serif font-semibold text-foreground tracking-tight">
          Profile
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Your base resume and the details used to tailor applications.
        </p>
      </div>

      {/* Base resume card */}
      <div className="rounded-2xl border border-border bg-card p-6 shadow-sm space-y-6">
        <div className="flex items-start gap-3">
          <div className="p-3 bg-primary/10 text-primary rounded-xl">
            <FileText className="w-6 h-6" />
          </div>
          <div className="flex-1">
            <h3 className="font-semibold text-lg">Base resume</h3>
            <p className="text-sm text-muted-foreground">
              Upload your standard .docx once. We parse it into structured data
              and capture its formatting. Max 5MB.
            </p>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row items-center gap-4 pt-4 border-t border-border">
          <div className="flex-1 w-full bg-muted/30 border border-border rounded-xl p-4 flex items-center justify-between">
            {hasResume ? (
              <div className="flex items-center gap-3 truncate pr-4">
                <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />
                <span className="text-sm font-medium truncate">
                  {profile!.resume_filename}
                </span>
              </div>
            ) : (
              <div className="text-sm text-muted-foreground italic">
                No resume uploaded yet
              </div>
            )}

            {hasResume && (
              <Button variant="ghost" size="sm" asChild className="shrink-0">
                <a
                  href={api.profile.getResumeUrl()}
                  target="_blank"
                  rel="noreferrer"
                >
                  <Download className="w-4 h-4 mr-2" /> Original
                </a>
              </Button>
            )}
          </div>

          <Button
            className="w-full sm:w-auto rounded-xl shrink-0"
            variant={hasResume ? "outline" : "default"}
            disabled={parseResume.isPending}
            onClick={() => (hasResume ? setReplaceOpen(true) : openFilePicker())}
          >
            {parseResume.isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Reading…
              </>
            ) : (
              <>
                <FileUp className="w-4 h-4 mr-2" />
                {hasResume ? "Replace" : "Upload .docx"}
              </>
            )}
          </Button>

          <input
            ref={fileInputRef}
            type="file"
            accept=".docx"
            className="hidden"
            onChange={handleFileChange}
          />
        </div>
      </div>

      {/* Structured resume summary */}
      {hasResume && profile?.resume_json?.sections?.length ? (
        <div className="rounded-2xl border border-border bg-card p-6 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold">Structured resume</h3>
            <Button
              variant="secondary"
              size="sm"
              className="rounded-lg"
              onClick={startEdit}
            >
              <Pencil className="w-4 h-4 mr-2" /> Edit
            </Button>
          </div>
          <div className="divide-y divide-border border-t border-border">
            {profile.resume_json.sections.map((sec) => (
              <div key={sec.id} className="py-3 flex items-baseline gap-3">
                <span className="text-xs uppercase tracking-wide text-primary/80 w-24 shrink-0">
                  {SECTION_KIND_LABELS[sec.kind]}
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">
                    {sec.heading || "—"}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">
                    {sectionPreview(sec)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : hasResume ? (
        <div className="rounded-2xl border border-dashed border-border p-6 text-sm text-muted-foreground">
          This resume hasn&rsquo;t been reviewed yet. Upload it again to parse
          and confirm its structure.
        </div>
      ) : null}

      {/* Extra answers */}
      <ExtraAnswers
        value={profile?.extra_answers_json ?? null}
        onSave={handleSaveAnswers}
        saving={updateProfile.isPending}
      />

      {/* Additional context */}
      <AdditionalContext
        value={profile?.extra_context ?? null}
        onSave={handleSaveContext}
        saving={updateProfile.isPending}
      />

      {/* Data & backup */}
      <div className="rounded-2xl border border-border bg-card p-6 shadow-sm space-y-4">
        <div className="flex items-start gap-3">
          <div className="p-3 bg-primary/10 text-primary rounded-xl shrink-0">
            <ShieldCheck className="w-6 h-6" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-lg">Your data</h3>
            <p className="text-sm text-muted-foreground">
              This app holds your career history. Download a full backup any time —
              a .zip with the database, a readable <code className="text-xs">data.json</code>,
              and every generated resume and cover letter.
            </p>
          </div>
        </div>
        <Button asChild variant="outline" className="w-full sm:w-auto rounded-xl">
          <a href={api.profile.getExportUrl()} download>
            <Archive className="w-4 h-4 mr-2" /> Download all my data
          </a>
        </Button>
      </div>

      <AlertDialog open={replaceOpen} onOpenChange={setReplaceOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Replace your base resume?</AlertDialogTitle>
            <AlertDialogDescription>
              Uploading a new file replaces your current parsed structure and
              formatting once you confirm the review. Your saved answers are
              kept.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setReplaceOpen(false);
                openFilePicker();
              }}
            >
              Choose file
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function sectionPreview(sec: ResumeSection): string {
  switch (sec.kind) {
    case "contact":
      return [sec.name, sec.email, sec.phone, sec.location]
        .filter(Boolean)
        .join(" · ");
    case "summary":
      return sec.paragraphs.join(" ").slice(0, 120);
    case "experience":
      return sec.items
        .map((i) => [i.title, i.company].filter(Boolean).join(" at "))
        .join("; ");
    case "education":
      return sec.items
        .map((i) => [i.qualification, i.institution].filter(Boolean).join(", "))
        .join("; ");
    case "skills":
      return sec.items.join(", ").slice(0, 120);
    case "other":
      return [...sec.paragraphs, ...sec.bullets].join(" ").slice(0, 120);
    default:
      return "";
  }
}
