import { useState } from "react";
import { Link } from "wouter";
import {
  useProfile,
  useRecordQa,
  useQuestionsStart,
  useQuestionsFinalize,
  useQuestionsSave,
} from "@/hooks/use-api";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  HelpCircle,
  Loader2,
  AlertTriangle,
  MessageSquareText,
  RefreshCw,
  Save,
  RotateCcw,
} from "lucide-react";
import { toast } from "sonner";
import type { Job, AppQuestionsResult } from "@/lib/api";
import { CopyButton } from "./CopyButton";
import { AiProgress } from "@/components/ui/ai-progress";

type Phase = "idle" | "questions" | "answers";

const DRAFT_STAGES = [
  "Reading your questions…",
  "Matching them to your real experience…",
  "Drafting grounded answers…",
  "Finishing up…",
];

export function AppQuestions({ job }: { job: Job }) {
  const { data: profile } = useProfile();
  const start = useQuestionsStart();
  const recordQa = useRecordQa();
  const finalize = useQuestionsFinalize();
  const saveHook = useQuestionsSave();

  const [phase, setPhase] = useState<Phase>("idle");
  const [questionsText, setQuestionsText] = useState("");
  const [result, setResult] = useState<AppQuestionsResult | null>(null);
  const [answers, setAnswers] = useState<{ question: string; answer: string }[]>([]);
  const [qIndex, setQIndex] = useState(0);
  const [currentAnswer, setCurrentAnswer] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const hasResume = !!profile?.resume_json?.sections?.length;

  const begin = () => {
    if (!questionsText.trim()) return;
    setError(null);
    setSaved(false);
    start.mutate(
      { id: job.id, data: { questions: questionsText } },
      {
        onSuccess: (res) => {
          setResult(res);
          setAnswers([]);
          setQIndex(0);
          setCurrentAnswer("");
          setPhase(res.clarifying_questions.length > 0 ? "questions" : "answers");
        },
        onError: (err) => setError(err.message),
      },
    );
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
      { id: job.id, data: { questions: questionsText, answers: next } },
      {
        onSuccess: (res) => {
          setResult(res);
          if (res.clarifying_questions.length > 0) {
            setQIndex(0);
            setPhase("questions");
          } else setPhase("answers");
        },
        onError: (err) => setError(err.message),
      },
    );
  };

  const saveAnswers = () => {
    if (!result?.answers.length) return;
    saveHook.mutate(
      { id: job.id, data: { answers: result.answers } },
      {
        onSuccess: () => {
          setSaved(true);
          toast.success("Answers saved to your history");
        },
        onError: (err) => toast.error("Could not save", { description: err.message }),
      },
    );
  };

  const reset = () => {
    setPhase("idle");
    setResult(null);
    setAnswers([]);
    setQIndex(0);
    setCurrentAnswer("");
    setError(null);
    setSaved(false);
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

  return (
    <div className="rounded-2xl border border-border bg-card p-6 shadow-sm space-y-4">
      <div className="flex items-center gap-2">
        <HelpCircle className="w-5 h-5 text-primary" />
        <h3 className="font-semibold text-lg">Help with application questions</h3>
      </div>

      {phase === "idle" && (
        <>
          <p className="text-sm text-muted-foreground">
            Paste one or more questions from the application form (e.g. selection criteria). Answers
            are drafted only from your resume and saved answers — never guessed.
          </p>
          {!hasResume && (
            <div className="flex items-start gap-2 rounded-xl border border-amber-300/60 bg-amber-50 dark:bg-amber-950/30 p-3 text-sm text-amber-800 dark:text-amber-300">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>
                Add your resume on the{" "}
                <Link href="/profile" className="underline font-medium">Profile page</Link> first.
              </span>
            </div>
          )}
          <Textarea
            value={questionsText}
            onChange={(e) => setQuestionsText(e.target.value)}
            placeholder={"Paste each question on its own line, e.g.\nDescribe a time you managed competing priorities.\nWhy do you want to work here?"}
            className="min-h-[120px]"
          />
          {start.isPending && <AiProgress stages={DRAFT_STAGES} />}
          {errorBox}
          <Button className="w-full rounded-xl" onClick={begin} disabled={!hasResume || !questionsText.trim() || start.isPending}>
            {start.isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Drafting…
              </>
            ) : (
              <>
                <HelpCircle className="w-4 h-4 mr-2" /> Draft answers
              </>
            )}
          </Button>
        </>
      )}

      {phase === "questions" && result && (
        <>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <MessageSquareText className="w-5 h-5 text-primary" />
              <span className="font-medium">A few questions first</span>
            </div>
            <Badge variant="secondary" className="rounded-full">
              {qIndex + 1} of {result.clarifying_questions.length}
            </Badge>
          </div>
          {answers.length > 0 && (
            <div className="space-y-2 border-t border-border pt-3">
              {answers.map((a, i) => (
                <div key={i} className="text-sm">
                  <p className="text-muted-foreground">{a.question}</p>
                  <p className="rounded-lg bg-muted/40 px-3 py-2 mt-1">{a.answer}</p>
                </div>
              ))}
            </div>
          )}
          <div className="rounded-xl border border-border p-4 space-y-3 bg-muted/10">
            <p className="font-medium">{result.clarifying_questions[qIndex].question}</p>
            {result.clarifying_questions[qIndex].why && (
              <p className="text-xs text-muted-foreground">Why: {result.clarifying_questions[qIndex].why}</p>
            )}
            <Textarea
              value={currentAnswer}
              onChange={(e) => setCurrentAnswer(e.target.value)}
              placeholder="Your answer (real facts only)…"
              className="min-h-[90px]"
              disabled={finalize.isPending}
            />
            <div className="flex justify-end">
              <Button onClick={submitAnswer} disabled={!currentAnswer.trim() || finalize.isPending} className="rounded-lg">
                {finalize.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Drafting…
                  </>
                ) : qIndex + 1 < result.clarifying_questions.length ? (
                  "Next"
                ) : (
                  "Finish & draft"
                )}
              </Button>
            </div>
          </div>
          {finalize.isPending && <AiProgress stages={DRAFT_STAGES} />}
          {errorBox}
        </>
      )}

      {phase === "answers" && result && (
        <>
          {result.answers.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No answers could be drafted from your current information.
            </p>
          ) : (
            <div className="space-y-3">
              {result.answers.map((a, i) => (
                <div key={i} className="rounded-xl border border-border p-4 space-y-2 bg-muted/10">
                  <p className="text-sm font-medium">{a.question}</p>
                  <p className="text-sm whitespace-pre-wrap">{a.answer}</p>
                  <div className="flex justify-end">
                    <CopyButton text={a.answer} label="Copy answer" className="rounded-lg" />
                  </div>
                </div>
              ))}
            </div>
          )}
          {result.clarifying_questions.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Some questions still need more from you — draft again after adding detail.
            </p>
          )}
          {errorBox}
          <div className="flex items-center justify-between gap-2">
            <Button variant="ghost" onClick={reset}>
              <RotateCcw className="w-4 h-4 mr-2" /> New questions
            </Button>
            {result.answers.length > 0 && (
              <Button onClick={saveAnswers} disabled={saveHook.isPending || saved} className="rounded-xl">
                {saveHook.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Saving…
                  </>
                ) : saved ? (
                  "Saved"
                ) : (
                  <>
                    <Save className="w-4 h-4 mr-2" /> Save to history
                  </>
                )}
              </Button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
