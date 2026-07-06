import { useState } from "react";
import { Link } from "wouter";
import {
  useProfile,
  useRecordQa,
  useCoverLetterStart,
  useCoverLetterFinalize,
  useCoverLetterRevise,
  useCoverLetterApprove,
} from "@/hooks/use-api";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Mail,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  MessageSquareText,
  RefreshCw,
  Pencil,
  RotateCcw,
} from "lucide-react";
import { toast } from "sonner";
import type { Job, CoverLetterResult } from "@/lib/api";
import { CopyButton } from "./CopyButton";
import { AiProgress } from "@/components/ui/ai-progress";

type Phase = "idle" | "questions" | "review" | "saved";

const WRITE_STAGES = [
  "Reading the posting…",
  "Drawing on your resume…",
  "Writing the full, plain and short versions…",
  "Making sure it doesn't sound AI-written…",
  "Finishing up…",
];
const REVISE_STAGES = [
  "Applying your change…",
  "Rewriting the three versions…",
  "Finishing up…",
];

export function CoverLetterFlow({
  job,
  alreadySaved = false,
}: {
  job: Job;
  /** True when this job already has saved cover letters (shows regenerate wording). */
  alreadySaved?: boolean;
}) {
  const { data: profile } = useProfile();
  const start = useCoverLetterStart();
  const recordQa = useRecordQa();
  const finalize = useCoverLetterFinalize();
  const revise = useCoverLetterRevise();
  const approve = useCoverLetterApprove();

  const [phase, setPhase] = useState<Phase>("idle");
  const [result, setResult] = useState<CoverLetterResult | null>(null);
  const [answers, setAnswers] = useState<{ question: string; answer: string }[]>([]);
  const [qIndex, setQIndex] = useState(0);
  const [currentAnswer, setCurrentAnswer] = useState("");
  const [editText, setEditText] = useState("");
  const [error, setError] = useState<string | null>(null);

  const hasResume = !!profile?.resume_json?.sections?.length;

  const begin = () => {
    setError(null);
    start.mutate(job.id, {
      onSuccess: (res) => {
        setResult(res);
        setAnswers([]);
        setQIndex(0);
        setCurrentAnswer("");
        setPhase(res.clarifying_questions.length > 0 ? "questions" : "review");
      },
      onError: (err) => setError(err.message),
    });
  };

  const submitAnswer = () => {
    if (!result) return;
    const q = result.clarifying_questions[qIndex];
    const ans = currentAnswer.trim();
    if (!ans) return;

    recordQa.mutate(
      { id: job.id, data: { question: q.question, answer: ans } },
      { onError: (err) => toast.error("Couldn't save that answer", { description: err.message }) },
    );

    const next = [...answers, { question: q.question, answer: ans }];
    setAnswers(next);
    setCurrentAnswer("");

    if (qIndex + 1 < result.clarifying_questions.length) {
      setQIndex(qIndex + 1);
      return;
    }
    setError(null);
    finalize.mutate(
      { id: job.id, data: { answers: next, current: result } },
      {
        onSuccess: (res) => {
          setResult(res);
          if (res.clarifying_questions.length > 0) {
            setQIndex(0);
            setPhase("questions");
          } else setPhase("review");
        },
        onError: (err) => setError(err.message),
      },
    );
  };

  const requestEdit = () => {
    if (!result || !editText.trim()) return;
    setError(null);
    revise.mutate(
      { id: job.id, data: { current: result, edit_request: editText.trim() } },
      {
        onSuccess: (res) => {
          setResult(res);
          setEditText("");
          toast.success("Cover letters updated");
        },
        onError: (err) => setError(err.message),
      },
    );
  };

  const doApprove = (res: CoverLetterResult) => {
    approve.mutate(
      { id: job.id, data: { full: res.full, short: res.short } },
      {
        onSuccess: () => {
          setPhase("saved");
          toast.success("Cover letters saved", { description: "Download the full letter from Documents." });
        },
        onError: (err) => toast.error("Could not save", { description: err.message }),
      },
    );
  };

  const save = () => {
    if (!result) return;
    const pending = editText.trim();
    // If the user typed a requested change but didn't click "Apply edit" first,
    // apply it now so saving always includes that change (regenerate, then save).
    if (pending) {
      setError(null);
      revise.mutate(
        { id: job.id, data: { current: result, edit_request: pending } },
        {
          onSuccess: (res) => {
            setResult(res);
            setEditText("");
            doApprove(res);
          },
          onError: (err) => setError(err.message),
        },
      );
      return;
    }
    doApprove(result);
  };

  const reset = () => {
    setPhase("idle");
    setResult(null);
    setAnswers([]);
    setQIndex(0);
    setCurrentAnswer("");
    setEditText("");
    setError(null);
  };

  const errorBox = error ? (
    <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 space-y-3">
      <div className="flex items-start gap-2 text-sm text-destructive">
        <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
        <span>{error}</span>
      </div>
      <Button variant="outline" size="sm" onClick={begin} className="rounded-lg">
        <RefreshCw className="w-4 h-4 mr-2" /> Try again
      </Button>
    </div>
  ) : null;

  if (phase === "idle" || phase === "saved") {
    return (
      <div className="rounded-2xl border border-border bg-card p-6 shadow-sm space-y-4">
        <div className="flex items-center gap-2">
          <Mail className="w-5 h-5 text-primary" />
          <h3 className="font-semibold text-lg">Cover letters</h3>
        </div>
        {phase === "saved" ? (
          <div className="flex items-start gap-2 rounded-xl border border-emerald-300/50 bg-emerald-50/60 dark:bg-emerald-950/20 p-3 text-sm">
            <CheckCircle2 className="w-4 h-4 mt-0.5 text-emerald-500 shrink-0" />
            <span>Saved. Download the full letter (.docx / PDF) and copy the plain and short versions from <b>Documents</b> below.</span>
          </div>
        ) : alreadySaved ? (
          <p className="text-sm text-muted-foreground">
            You've already saved cover letters for this job. Generate again to rewrite them —
            you can request changes in the review step, and saving <b>replaces</b> the saved versions.
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            Three versions in one pass — a full letter, a plain body for form fields, and a short note.
            Grounded in your resume, never AI-sounding.
          </p>
        )}
        {!hasResume && (
          <div className="flex items-start gap-2 rounded-xl border border-amber-300/60 bg-amber-50 dark:bg-amber-950/30 p-3 text-sm text-amber-800 dark:text-amber-300">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>
              Add your resume on the{" "}
              <Link href="/profile" className="underline font-medium">Profile page</Link> first.
            </span>
          </div>
        )}
        {start.isPending && <AiProgress stages={WRITE_STAGES} />}
        {errorBox}
        <Button className="w-full rounded-xl" onClick={begin} disabled={!hasResume || start.isPending}>
          {start.isPending ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Writing…
            </>
          ) : (
            <>
              <Mail className="w-4 h-4 mr-2" />{" "}
              {phase === "saved"
                ? "Generate again"
                : alreadySaved
                  ? "Regenerate cover letters"
                  : "Generate cover letters"}
            </>
          )}
        </Button>
      </div>
    );
  }

  if (phase === "questions" && result) {
    const q = result.clarifying_questions[qIndex];
    const total = result.clarifying_questions.length;
    return (
      <div className="rounded-2xl border border-border bg-card p-6 shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MessageSquareText className="w-5 h-5 text-primary" />
            <h3 className="font-semibold text-lg">A few questions</h3>
          </div>
          <Badge variant="secondary" className="rounded-full">{qIndex + 1} of {total}</Badge>
        </div>
        {answers.length > 0 && (
          <div className="space-y-2 border-t border-border pt-4">
            {answers.map((a, i) => (
              <div key={i} className="text-sm">
                <p className="text-muted-foreground">{a.question}</p>
                <p className="rounded-lg bg-muted/40 px-3 py-2 mt-1">{a.answer}</p>
              </div>
            ))}
          </div>
        )}
        <div className="rounded-xl border border-border p-4 space-y-3 bg-muted/10">
          <p className="font-medium">{q.question}</p>
          {q.why && <p className="text-xs text-muted-foreground">Why: {q.why}</p>}
          <Textarea
            value={currentAnswer}
            onChange={(e) => setCurrentAnswer(e.target.value)}
            placeholder="Your answer (use real facts only)…"
            className="min-h-[90px]"
            disabled={finalize.isPending}
          />
          <div className="flex justify-end">
            <Button onClick={submitAnswer} disabled={!currentAnswer.trim() || finalize.isPending} className="rounded-lg">
              {finalize.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Writing…
                </>
              ) : qIndex + 1 < total ? (
                "Next question"
              ) : (
                "Finish & write"
              )}
            </Button>
          </div>
        </div>
        {finalize.isPending && <AiProgress stages={WRITE_STAGES} />}
        {errorBox}
      </div>
    );
  }

  if (phase === "review" && result) {
    return (
      <div className="rounded-2xl border border-border bg-card p-6 shadow-sm space-y-5">
        <div className="flex items-center gap-2">
          <Mail className="w-5 h-5 text-primary" />
          <h3 className="font-semibold text-lg">Cover letters</h3>
        </div>

        <Section title="Full letter" subtitle="Download as .docx / PDF after you save.">
          <div className="rounded-xl border border-border bg-muted/10 p-4 text-sm whitespace-pre-wrap">
            {result.full.salutation && <p>{result.full.salutation}</p>}
            {result.full.re && <p className="font-medium mt-2">{result.full.re}</p>}
            <p className="mt-3">{result.full.body}</p>
            <p className="mt-3">Sincerely,</p>
          </div>
          <CopyButton text={fullLetterText(result)} label="Copy full letter" className="rounded-lg" />
        </Section>

        <Section title="Plain version" subtitle="Body only — paste into a form field.">
          <div className="rounded-xl border border-border bg-muted/10 p-4 text-sm whitespace-pre-wrap">
            {result.full.body}
          </div>
          <CopyButton text={result.full.body} label="Copy plain text" className="rounded-lg" />
        </Section>

        <Section title="Short note" subtitle="3–5 sentences for a message field or email.">
          <div className="rounded-xl border border-border bg-muted/10 p-4 text-sm whitespace-pre-wrap">
            {result.short}
          </div>
          <CopyButton text={result.short} label="Copy note" className="rounded-lg" />
        </Section>

        <div className="rounded-xl border border-border p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Pencil className="w-4 h-4 text-primary" />
            <h4 className="font-medium">Request a change</h4>
          </div>
          <Textarea
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            placeholder='e.g. "Warmer opening" or "Cut the second paragraph"'
            className="min-h-[70px]"
            disabled={revise.isPending}
          />
          <div className="flex justify-end">
            <Button variant="secondary" onClick={requestEdit} disabled={!editText.trim() || revise.isPending} className="rounded-lg">
              {revise.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Rewriting…
                </>
              ) : (
                <>
                  <RefreshCw className="w-4 h-4 mr-2" /> Apply edit
                </>
              )}
            </Button>
          </div>
          {editText.trim() && !revise.isPending && (
            <p className="text-xs text-muted-foreground">
              This change isn't applied yet — click <b>Apply edit</b> to preview it, or just{" "}
              <b>Save</b> below (saving applies it first).
            </p>
          )}
          {revise.isPending && <AiProgress stages={REVISE_STAGES} />}
        </div>

        {errorBox}

        <div className="flex items-center justify-between gap-2">
          <Button variant="ghost" onClick={reset} disabled={approve.isPending}>
            <RotateCcw className="w-4 h-4 mr-2" /> Start over
          </Button>
          <Button onClick={save} disabled={approve.isPending || revise.isPending} className="rounded-xl px-8">
            {revise.isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Applying change…
              </>
            ) : approve.isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Saving…
              </>
            ) : editText.trim() ? (
              <>
                <RefreshCw className="w-4 h-4 mr-2" /> Apply change &amp; save
              </>
            ) : (
              <>
                <CheckCircle2 className="w-4 h-4 mr-2" /> Save all three
              </>
            )}
          </Button>
        </div>
      </div>
    );
  }

  return null;
}

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div>
        <p className="font-medium text-sm">{title}</p>
        <p className="text-xs text-muted-foreground">{subtitle}</p>
      </div>
      {children}
    </div>
  );
}

function fullLetterText(r: CoverLetterResult): string {
  return [r.full.salutation, "", r.full.re, "", r.full.body, "", "Sincerely,"]
    .filter((l) => l !== undefined)
    .join("\n");
}
