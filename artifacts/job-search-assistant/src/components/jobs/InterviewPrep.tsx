import { useState } from "react";
import { Link } from "wouter";
import { useProfile, useGenerateInterviewPrep, useSaveInterviewPrep } from "@/hooks/use-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
import { AlertTriangle, ClipboardCheck, Loader2, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { Document, InterviewPrep as Pack, Job, PrepStory } from "@/lib/api";
import { AiProgress } from "@/components/ui/ai-progress";
import { InfoTip } from "@/components/InfoTip";

type Section = "stories" | "questions" | "gaps" | "ask";

const PACK_KEY = {
  stories: "stories",
  questions: "questions",
  gaps: "gaps",
  ask: "questions_to_ask",
} as const satisfies Record<Section, keyof Pack>;

const ID_PREFIX: Record<Section, string> = { stories: "s", questions: "q", gaps: "g", ask: "a" };

interface Field {
  key: string;
  label: string;
  multiline?: boolean;
}

const FIELDS: Record<Section, Field[]> = {
  stories: [
    { key: "title", label: "Title" },
    { key: "requirement", label: "Requirement it answers" },
    { key: "situation", label: "Situation", multiline: true },
    { key: "action", label: "What I did", multiline: true },
    { key: "result", label: "Result", multiline: true },
    { key: "metric", label: "Metric" },
    { key: "source", label: "Source" },
  ],
  questions: [
    { key: "question", label: "Question", multiline: true },
    { key: "angle", label: "Angle", multiline: true },
  ],
  gaps: [
    { key: "requirement", label: "Requirement" },
    { key: "gap", label: "Gap", multiline: true },
    { key: "how_to_handle", label: "How to handle it", multiline: true },
  ],
  ask: [
    { key: "question", label: "Question", multiline: true },
    { key: "why", label: "Why ask", multiline: true },
  ],
};

type Item = Record<string, string | null>;

interface Editing {
  section: Section;
  draft: Item;
  isNew: boolean;
}

// Module scope so AiProgress's timer isn't reset on render.
const GEN_STAGES = [
  "Reading the posting…",
  "Going through your resume and saved answers…",
  "Choosing your strongest real stories…",
  "Mapping likely questions to stories…",
  "Checking for gaps…",
  "Finishing the pack…",
];

const EMPTY: Pack = { stories: [], questions: [], gaps: [], questions_to_ask: [] };

function asPack(content: unknown): Pack {
  const c = (content ?? {}) as Partial<Pack>;
  return {
    stories: Array.isArray(c.stories) ? c.stories : [],
    questions: Array.isArray(c.questions) ? c.questions : [],
    gaps: Array.isArray(c.gaps) ? c.gaps : [],
    questions_to_ask: Array.isArray(c.questions_to_ask) ? c.questions_to_ask : [],
  };
}

function nextId(prefix: string, items: { id: string }[]): string {
  const max = items.reduce((m, it) => {
    const n = it.id.startsWith(prefix) ? parseInt(it.id.slice(prefix.length), 10) : NaN;
    return Number.isNaN(n) ? m : Math.max(m, n);
  }, 0);
  return `${prefix}${max + 1}`;
}

export function InterviewPrep({ job, doc }: { job: Job; doc?: Document }) {
  const { data: profile } = useProfile();
  const generate = useGenerateInterviewPrep(job.id);
  const save = useSaveInterviewPrep(job.id);

  const [tab, setTab] = useState<Section>("stories");
  const [openStories, setOpenStories] = useState<string[]>([]);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const pack = doc ? asPack(doc.content_json) : null;
  const hasResume = !!profile?.resume_json?.sections?.length;
  const busy = generate.isPending;

  const run = () => {
    setError(null);
    setEditing(null);
    generate.mutate(undefined, {
      onSuccess: () => {
        setTab("stories");
        setOpenStories([]);
        toast.success("Interview prep ready");
      },
      onError: (err) => setError(err.message),
    });
  };

  const commit = (next: Pack) =>
    save.mutate(next, {
      onSuccess: () => setEditing(null),
      onError: (err) => toast.error("Couldn't save that", { description: err.message }),
    });

  const startEdit = (section: Section, item: object) =>
    setEditing({ section, draft: { ...(item as Item) }, isNew: false });

  const startAdd = (section: Section) => {
    const current = (pack ?? EMPTY)[PACK_KEY[section]];
    const draft: Item = { id: nextId(ID_PREFIX[section], current) };
    for (const f of FIELDS[section]) draft[f.key] = "";
    if (section === "stories") draft.metric = null;
    if (section === "questions") draft.story_id = "";
    setEditing({ section, draft, isNew: true });
  };

  const saveEdit = () => {
    if (!pack || !editing) return;
    const { section, draft, isNew } = editing;
    const item: Item = { ...draft };
    if (section === "stories") item.metric = (item.metric ?? "").trim() || null;
    const key = PACK_KEY[section];
    const list = pack[key] as unknown as Item[];
    const nextList = isNew ? [...list, item] : list.map((it) => (it.id === item.id ? item : it));
    commit({ ...pack, [key]: nextList });
  };

  const deleteEdit = () => {
    if (!pack || !editing || editing.isNew) return;
    const { section, draft } = editing;
    const key = PACK_KEY[section];
    const next: Pack = {
      ...pack,
      [key]: (pack[key] as unknown as Item[]).filter((it) => it.id !== draft.id),
    };
    // Questions that pointed at a deleted story lose the link rather than vanish.
    if (section === "stories") {
      next.questions = next.questions.map((q) => (q.story_id === draft.id ? { ...q, story_id: "" } : q));
    }
    commit(next);
  };

  const storyLabel = (id: string): string | null => {
    const i = pack?.stories.findIndex((s) => s.id === id) ?? -1;
    return i >= 0 ? `Story ${i + 1} · ${pack!.stories[i].title}` : null;
  };

  const jumpToStory = (id: string) => {
    setTab("stories");
    setOpenStories((prev) => (prev.includes(id) ? prev : [...prev, id]));
    setTimeout(() => document.getElementById(`prep-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
  };

  const editorFor = (section: Section, id?: string) =>
    editing && editing.section === section && (id === undefined ? editing.isNew : !editing.isNew && editing.draft.id === id) ? (
      <ItemEditor
        key={`edit-${id ?? "new"}`}
        fields={FIELDS[section]}
        draft={editing.draft}
        onChange={(draft) => setEditing({ ...editing, draft })}
        stories={section === "questions" ? pack?.stories ?? [] : undefined}
        saving={save.isPending}
        onSave={saveEdit}
        onCancel={() => setEditing(null)}
        onDelete={editing.isNew ? undefined : deleteEdit}
      />
    ) : null;

  const editButton = (section: Section, item: object) => (
    <Button
      variant="ghost"
      size="icon"
      className="h-11 w-11 md:h-8 md:w-8 shrink-0 text-muted-foreground"
      aria-label="Edit"
      disabled={!!editing}
      onClick={() => startEdit(section, item)}
    >
      <Pencil className="w-4 h-4" />
    </Button>
  );

  const addButton = (section: Section, label: string) =>
    !(editing?.isNew && editing.section === section) && (
      <Button variant="ghost" size="sm" className="rounded-lg text-muted-foreground" disabled={!!editing} onClick={() => startAdd(section)}>
        <Plus className="w-4 h-4 mr-1.5" /> {label}
      </Button>
    );

  const errorBox = error ? (
    <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 space-y-3">
      <div className="flex items-start gap-2 text-sm text-destructive">
        <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
        <span className="break-words">{error}</span>
      </div>
      <Button variant="outline" size="sm" onClick={run} className="rounded-lg">
        <RefreshCw className="w-4 h-4 mr-2" /> Try again
      </Button>
    </div>
  ) : null;

  return (
    <div className="rounded-2xl border border-border bg-card p-4 sm:p-6 shadow-sm space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <ClipboardCheck className="w-5 h-5 text-primary shrink-0" />
          <h3 className="font-semibold text-lg">Interview prep</h3>
          <InfoTip label="About interview prep">
            Built only from your resume, saved answers and this role's chat. A story with no real number
            on record says so rather than inventing one.
          </InfoTip>
        </div>
        {pack && !busy && (
          <Button
            variant="ghost"
            size="sm"
            className="rounded-lg text-muted-foreground shrink-0"
            disabled={!!editing || save.isPending}
            onClick={() => setConfirmOpen(true)}
          >
            <RefreshCw className="w-4 h-4 mr-1.5" /> Regenerate
          </Button>
        )}
      </div>

      {!pack && !busy && (
        <>
          {!hasResume && (
            <div className="flex items-start gap-2 rounded-xl border border-amber-300/60 bg-amber-50 dark:bg-amber-950/30 p-3 text-sm text-amber-800 dark:text-amber-300">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>
                Add your resume on the{" "}
                <Link href="/profile" className="underline font-medium">Profile page</Link> first.
              </span>
            </div>
          )}
          {errorBox}
          {!error && (
            <Button className="w-full rounded-xl" onClick={run} disabled={!hasResume || !job.posting_text}>
              <ClipboardCheck className="w-4 h-4 mr-2" /> Build prep pack
            </Button>
          )}
        </>
      )}

      {busy && <AiProgress stages={GEN_STAGES} intervalMs={9000} />}

      {pack && !busy && (
        <>
          {errorBox}
          <Tabs value={tab} onValueChange={(v) => setTab(v as Section)}>
            <TabsList className="grid h-auto w-full grid-cols-2 sm:grid-cols-4 gap-1">
              <TabsTrigger value="stories">
                Stories <Count n={pack.stories.length} />
              </TabsTrigger>
              <TabsTrigger value="questions">
                Questions <Count n={pack.questions.length} />
              </TabsTrigger>
              <TabsTrigger value="gaps">
                Gaps <Count n={pack.gaps.length} />
              </TabsTrigger>
              <TabsTrigger value="ask">
                Ask them <Count n={pack.questions_to_ask.length} />
              </TabsTrigger>
            </TabsList>

            <TabsContent value="stories" className="space-y-3 mt-4">
              <Accordion type="multiple" value={openStories} onValueChange={setOpenStories} className="space-y-2">
                {pack.stories.map((s, i) => (
                  <AccordionItem
                    key={s.id}
                    value={s.id}
                    id={`prep-${s.id}`}
                    className="rounded-xl border border-border bg-background px-3 sm:px-4 scroll-mt-24"
                  >
                    <AccordionTrigger className="py-3 text-left hover:no-underline">
                      <div className="flex items-start gap-3 min-w-0">
                        <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                          {i + 1}
                        </span>
                        <div className="min-w-0">
                          <div className="font-medium break-words">{s.title || "Untitled story"}</div>
                          {s.requirement && (
                            <div className="text-xs text-muted-foreground font-normal break-words mt-0.5">{s.requirement}</div>
                          )}
                        </div>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent className="pb-4">
                      {editorFor("stories", s.id) ?? <StoryView story={s} action={editButton("stories", s)} />}
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
              {editorFor("stories")}
              {addButton("stories", "Add story")}
            </TabsContent>

            <TabsContent value="questions" className="space-y-3 mt-4">
              {pack.questions.length === 0 && <Empty />}
              {pack.questions.map((q, i) =>
                editorFor("questions", q.id) ?? (
                  <div key={q.id} className="rounded-xl border border-border bg-background p-3 sm:p-4 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-medium break-words">
                        <span className="text-muted-foreground mr-1.5">{i + 1}.</span>
                        {q.question}
                      </p>
                      {editButton("questions", q)}
                    </div>
                    {storyLabel(q.story_id) ? (
                      <button
                        type="button"
                        onClick={() => jumpToStory(q.story_id)}
                        className="text-left text-sm font-medium text-primary hover:underline break-words"
                      >
                        → {storyLabel(q.story_id)}
                      </button>
                    ) : (
                      <p className="text-sm text-amber-700 dark:text-amber-300">No story linked</p>
                    )}
                    {q.angle && <p className="text-sm text-muted-foreground break-words">{q.angle}</p>}
                  </div>
                ),
              )}
              {editorFor("questions")}
              {addButton("questions", "Add question")}
            </TabsContent>

            <TabsContent value="gaps" className="space-y-3 mt-4">
              {pack.gaps.length === 0 && <Empty />}
              {pack.gaps.map((g) =>
                editorFor("gaps", g.id) ?? (
                  <div key={g.id} className="rounded-xl border border-border bg-background p-3 sm:p-4 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-medium break-words">{g.requirement}</p>
                      {editButton("gaps", g)}
                    </div>
                    {g.gap && <p className="text-sm break-words">{g.gap}</p>}
                    {g.how_to_handle && (
                      <div className="space-y-0.5">
                        <div className="text-xs font-medium text-muted-foreground">How to handle it</div>
                        <p className="text-sm break-words">{g.how_to_handle}</p>
                      </div>
                    )}
                  </div>
                ),
              )}
              {editorFor("gaps")}
              {addButton("gaps", "Add gap")}
            </TabsContent>

            <TabsContent value="ask" className="space-y-3 mt-4">
              {pack.questions_to_ask.length === 0 && <Empty />}
              {pack.questions_to_ask.map((a) =>
                editorFor("ask", a.id) ?? (
                  <div key={a.id} className="rounded-xl border border-border bg-background p-3 sm:p-4 space-y-1.5">
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-medium break-words">{a.question}</p>
                      {editButton("ask", a)}
                    </div>
                    {a.why && <p className="text-sm text-muted-foreground break-words">{a.why}</p>}
                  </div>
                ),
              )}
              {editorFor("ask")}
              {addButton("ask", "Add question")}
            </TabsContent>
          </Tabs>
        </>
      )}

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Regenerate the prep pack?</AlertDialogTitle>
            <AlertDialogDescription>This replaces the whole pack, including your edits.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={run}>Regenerate</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Count({ n }: { n: number }) {
  return <span className="ml-1.5 text-xs opacity-60">{n}</span>;
}

function Empty() {
  return <p className="text-sm text-muted-foreground">None</p>;
}

function StoryView({ story, action }: { story: PrepStory; action: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="space-y-3 min-w-0">
          <Part label="Situation" text={story.situation} />
          <Part label="What I did" text={story.action} />
          <Part label="Result" text={story.result} />
        </div>
        {action}
      </div>
      <div className="space-y-0.5">
        <div className="text-xs font-medium text-muted-foreground">Metric</div>
        {story.metric ? (
          <p className="text-sm font-medium break-words">{story.metric}</p>
        ) : (
          <p className="text-sm italic text-amber-700 dark:text-amber-300">No real metric on record</p>
        )}
      </div>
      {story.source && <p className="text-xs text-muted-foreground break-words">Source: {story.source}</p>}
    </div>
  );
}

function Part({ label, text }: { label: string; text: string }) {
  if (!text) return null;
  return (
    <div className="space-y-0.5">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <p className="text-sm leading-relaxed break-words">{text}</p>
    </div>
  );
}

function ItemEditor({
  fields,
  draft,
  onChange,
  stories,
  saving,
  onSave,
  onCancel,
  onDelete,
}: {
  fields: Field[];
  draft: Item;
  onChange: (draft: Item) => void;
  stories?: PrepStory[];
  saving: boolean;
  onSave: () => void;
  onCancel: () => void;
  onDelete?: () => void;
}) {
  const set = (key: string, value: string) => onChange({ ...draft, [key]: value });
  const fieldId = (key: string) => `prep-edit-${draft.id}-${key}`;
  const canSave = fields.some((f) => (draft[f.key] ?? "").trim());

  return (
    <div className="rounded-xl border border-primary/30 bg-muted/20 p-3 sm:p-4 space-y-3">
      {fields.map((f) => (
        <div key={f.key} className="space-y-1.5">
          <Label htmlFor={fieldId(f.key)} className="text-xs text-muted-foreground">
            {f.label}
          </Label>
          {f.multiline ? (
            <Textarea
              id={fieldId(f.key)}
              value={draft[f.key] ?? ""}
              onChange={(e) => set(f.key, e.target.value)}
              className="min-h-[80px]"
            />
          ) : (
            <Input id={fieldId(f.key)} value={draft[f.key] ?? ""} onChange={(e) => set(f.key, e.target.value)} />
          )}
        </div>
      ))}
      {stories && (
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Story</Label>
          <Select value={draft.story_id || undefined} onValueChange={(v) => set("story_id", v)}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Pick a story" />
            </SelectTrigger>
            <SelectContent>
              {stories.map((s, i) => (
                <SelectItem key={s.id} value={s.id}>
                  {i + 1}. {s.title || "Untitled story"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
        {onDelete ? (
          <Button variant="ghost" size="sm" className="rounded-lg text-destructive" onClick={onDelete} disabled={saving}>
            <Trash2 className="w-4 h-4 mr-1.5" /> Delete
          </Button>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" className="rounded-lg" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
          <Button size="sm" className="rounded-lg" onClick={onSave} disabled={saving || !canSave}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save"}
          </Button>
        </div>
      </div>
    </div>
  );
}
