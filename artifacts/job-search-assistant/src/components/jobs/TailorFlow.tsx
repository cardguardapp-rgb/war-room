import { useState } from "react";
import { Link } from "wouter";
import {
  useProfile,
  useTailorStart,
  useRecordQa,
  useTailorFinalize,
  useTailorRevise,
  useTailorApprove,
} from "@/hooks/use-api";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Sparkles,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  ShieldAlert,
  Search,
  MessageSquareText,
  RefreshCw,
  Pencil,
  RotateCcw,
} from "lucide-react";
import { toast } from "sonner";
import type { Job, RecruiterFeedback, TailorResult } from "@/lib/api";
import { ResumeDiff } from "./ResumeDiff";
import { AiProgress } from "@/components/ui/ai-progress";

type Phase = "idle" | "questions" | "review" | "done";

// Stable (module-scope) status sequences for the long AI calls.
const TAILOR_STAGES = [
  "Reading the posting…",
  "Comparing it against your resume…",
  "Rewording your bullets and summary…",
  "Running the honest recruiter review…",
  "Finishing up…",
];
const FINALISE_STAGES = [
  "Taking in your answers…",
  "Rebuilding the tailored resume…",
  "Running the recruiter review…",
  "Finishing up…",
];
const REVISE_STAGES = [
  "Applying your edit…",
  "Re-checking the resume…",
  "Finishing up…",
];

export function TailorFlow({
  job,
  alreadyTailored = false,
}: {
  job: Job;
  /** True when this job already has a saved tailored resume (enables re-tailor UI). */
  alreadyTailored?: boolean;
}) {
  const { data: profile } = useProfile();
  const start = useTailorStart();
  const recordQa = useRecordQa();
  const finalize = useTailorFinalize();
  const revise = useTailorRevise();
  const approve = useTailorApprove();

  const [phase, setPhase] = useState<Phase>("idle");
  const [result, setResult] = useState<TailorResult | null>(null);
  const [answers, setAnswers] = useState<{ question: string; answer: string }[]>([]);
  const [qIndex, setQIndex] = useState(0);
  const [currentAnswer, setCurrentAnswer] = useState("");
  const [editText, setEditText] = useState("");
  const [error, setError] = useState<string | null>(null);

  const hasResume = !!profile?.resume_json?.sections?.length;
  const hasPosting = !!job.posting_text && job.posting_text.trim().length > 0;
  const originalResume = profile?.resume_json ?? null;

  const startTailor = () => {
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

    // Persist to qa_log + profile.extra_answers_json (fire-and-forget).
    recordQa.mutate(
      { id: job.id, data: { question: q.question, answer: ans } },
      { onError: (err) => toast.error("Couldn't save that answer", { description: err.message }) },
    );

    const nextAnswers = [...answers, { question: q.question, answer: ans }];
    setAnswers(nextAnswers);
    setCurrentAnswer("");

    if (qIndex + 1 < result.clarifying_questions.length) {
      setQIndex(qIndex + 1);
      return;
    }

    // Last question answered — run the final tailoring pass.
    setError(null);
    finalize.mutate(
      { id: job.id, data: { answers: nextAnswers, current_resume: result.proposed_resume } },
      {
        onSuccess: (res) => {
          setResult(res);
          if (res.clarifying_questions.length > 0) {
            setQIndex(0);
            setPhase("questions");
          } else {
            setPhase("review");
          }
        },
        onError: (err) => setError(err.message),
      },
    );
  };

  const requestEdit = () => {
    if (!result || !editText.trim()) return;
    setError(null);
    revise.mutate(
      { id: job.id, data: { proposed_resume: result.proposed_resume, edit_request: editText.trim() } },
      {
        onSuccess: (res) => {
          setResult(res);
          setEditText("");
          toast.success("Updated the tailored resume");
        },
        onError: (err) => setError(err.message),
      },
    );
  };

  const approveResume = () => {
    if (!result) return;
    approve.mutate(
      { id: job.id, data: { proposed_resume: result.proposed_resume } },
      {
        onSuccess: () => {
          setPhase("done");
          toast.success("Tailored resume approved", {
            description: "Saved to this job and marked Ready.",
          });
        },
        onError: (err) => toast.error("Could not save", { description: err.message }),
      },
    );
  };

  const resetFlow = () => {
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
      <Button variant="outline" size="sm" onClick={startTailor} className="rounded-lg">
        <RefreshCw className="w-4 h-4 mr-2" /> Try again
      </Button>
    </div>
  ) : null;

  // ---- idle ----
  if (phase === "idle") {
    return (
      <div className="rounded-2xl border border-primary/20 bg-primary/5 p-6 shadow-sm space-y-4">
        <div className="flex items-center gap-2 text-primary">
          {alreadyTailored ? <RefreshCw className="w-5 h-5" /> : <Sparkles className="w-5 h-5" />}
          <h3 className="font-semibold text-lg">
            {alreadyTailored ? "Re-tailor your resume" : "Tailor your resume"}
          </h3>
        </div>
        <p className="text-sm text-muted-foreground">
          {alreadyTailored
            ? "You've already saved a tailored resume for this job. Re-tailoring regenerates the wording from scratch with the latest improvements and replaces the saved version. It still never invents experience — it asks when a fact is missing."
            : "A senior-recruiter pass reworks your real resume to this posting — honest feedback included. It never invents experience; it asks you when a fact is missing."}
        </p>
        {!hasResume && (
          <div className="flex items-start gap-2 rounded-xl border border-amber-300/60 bg-amber-50 dark:bg-amber-950/30 p-3 text-sm text-amber-800 dark:text-amber-300">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>
              Add and confirm your base resume on the{" "}
              <Link href="/profile" className="underline font-medium">
                Profile page
              </Link>{" "}
              first.
            </span>
          </div>
        )}
        {!hasPosting && (
          <div className="flex items-start gap-2 rounded-xl border border-amber-300/60 bg-amber-50 dark:bg-amber-950/30 p-3 text-sm text-amber-800 dark:text-amber-300">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>This job has no posting text to tailor against.</span>
          </div>
        )}
        {start.isPending && <AiProgress stages={TAILOR_STAGES} />}
        {errorBox}
        <Button
          className="w-full rounded-xl"
          onClick={startTailor}
          disabled={!hasResume || !hasPosting || start.isPending}
        >
          {start.isPending ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Analysing the role…
            </>
          ) : alreadyTailored ? (
            <>
              <RefreshCw className="w-4 h-4 mr-2" /> Re-tailor resume
            </>
          ) : (
            <>
              <Sparkles className="w-4 h-4 mr-2" /> Tailor resume
            </>
          )}
        </Button>
      </div>
    );
  }

  // ---- done ----
  if (phase === "done") {
    return (
      <div className="rounded-2xl border border-emerald-300/50 bg-emerald-50/60 dark:bg-emerald-950/20 p-6 shadow-sm space-y-4 text-center">
        <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto" />
        <div>
          <h3 className="font-semibold text-lg">Tailored resume approved</h3>
          <p className="text-sm text-muted-foreground">
            Saved to this job's documents and the status is now Ready.
          </p>
        </div>
        <Button variant="outline" onClick={resetFlow} className="rounded-xl">
          <RotateCcw className="w-4 h-4 mr-2" /> Tailor again
        </Button>
      </div>
    );
  }

  // ---- questions ----
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
          <Badge variant="secondary" className="rounded-full">
            {qIndex + 1} of {total}
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          The resume can't be tailored honestly without these. Your answers are saved
          for future applications too.
        </p>

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
          {q.affects && (
            <Badge variant="outline" className="text-xs font-normal">
              Affects: {q.affects}
            </Badge>
          )}
          <Textarea
            value={currentAnswer}
            onChange={(e) => setCurrentAnswer(e.target.value)}
            placeholder="Your answer (use the real figure/outcome — never a guess)…"
            className="min-h-[90px]"
            disabled={finalize.isPending}
          />
          <div className="flex justify-end">
            <Button
              onClick={submitAnswer}
              disabled={!currentAnswer.trim() || finalize.isPending}
              className="rounded-lg"
            >
              {finalize.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Building your resume…
                </>
              ) : qIndex + 1 < total ? (
                "Next question"
              ) : (
                "Finish & tailor"
              )}
            </Button>
          </div>
        </div>
        {finalize.isPending && <AiProgress stages={FINALISE_STAGES} />}
        {errorBox}
      </div>
    );
  }

  // ---- review ----
  if (phase === "review" && result) {
    return (
      <div className="space-y-6">
        <RecruiterReview feedback={result.recruiter_feedback} />

        {result.clarifying_questions.length > 0 && (
          <div className="rounded-2xl border border-amber-300/60 bg-amber-50 dark:bg-amber-950/30 p-4 text-sm text-amber-800 dark:text-amber-300 space-y-1">
            <p className="font-medium">Still worth answering:</p>
            <ul className="list-disc pl-5">
              {result.clarifying_questions.map((q, i) => (
                <li key={i}>{q.question}</li>
              ))}
            </ul>
            <p className="text-xs">Use the edit box below to supply these, then re-run.</p>
          </div>
        )}

        <div>
          <h3 className="font-semibold text-lg mb-3">What changed</h3>
          <ResumeDiff original={originalResume} proposed={result.proposed_resume} />
        </div>

        <div className="rounded-2xl border border-border bg-card p-5 shadow-sm space-y-3">
          <div className="flex items-center gap-2">
            <Pencil className="w-4 h-4 text-primary" />
            <h4 className="font-medium">Request an edit</h4>
          </div>
          <Textarea
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            placeholder='e.g. "Make the second bullet under MYOB shorter" or "Emphasise SQL more"'
            className="min-h-[70px]"
            disabled={revise.isPending}
          />
          <div className="flex justify-end">
            <Button
              variant="secondary"
              onClick={requestEdit}
              disabled={!editText.trim() || revise.isPending}
              className="rounded-lg"
            >
              {revise.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Revising…
                </>
              ) : (
                <>
                  <RefreshCw className="w-4 h-4 mr-2" /> Apply edit
                </>
              )}
            </Button>
          </div>
          {revise.isPending && <AiProgress stages={REVISE_STAGES} />}
        </div>

        {errorBox}

        <div className="flex items-center justify-between gap-2 sticky bottom-0 bg-background/95 backdrop-blur py-3 border-t border-border">
          <Button variant="ghost" onClick={resetFlow} disabled={approve.isPending}>
            <RotateCcw className="w-4 h-4 mr-2" /> Start over
          </Button>
          <Button
            onClick={approveResume}
            disabled={approve.isPending || revise.isPending}
            className="rounded-xl px-8"
          >
            {approve.isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Saving…
              </>
            ) : (
              <>
                <CheckCircle2 className="w-4 h-4 mr-2" /> Approve
              </>
            )}
          </Button>
        </div>
      </div>
    );
  }

  return null;
}

function RecruiterReview({ feedback }: { feedback: RecruiterFeedback }) {
  const { rejection_risks, ats_gaps, overall } = feedback;
  const nothing = !overall && rejection_risks.length === 0 && ats_gaps.length === 0;
  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-sm space-y-4">
      <div className="flex items-center gap-2">
        <ShieldAlert className="w-5 h-5 text-primary" />
        <h3 className="font-semibold text-lg">Honest recruiter review</h3>
      </div>

      {overall && <p className="text-sm">{overall}</p>}

      {rejection_risks.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-medium uppercase tracking-wide text-destructive flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5" /> Rejection risks
          </p>
          <ul className="list-disc pl-5 text-sm space-y-1">
            {rejection_risks.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </div>
      )}

      {ats_gaps.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-medium uppercase tracking-wide text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
            <Search className="w-3.5 h-3.5" /> ATS keywords not truthfully includable
          </p>
          <div className="flex flex-wrap gap-1.5">
            {ats_gaps.map((k, i) => (
              <Badge key={i} variant="outline" className="font-normal">
                {k}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {nothing && (
        <p className="text-sm text-muted-foreground">
          No blocking issues flagged. Review the changes below.
        </p>
      )}
    </div>
  );
}
