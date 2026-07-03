import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { MessagesSquare, Plus, Save, Trash2 } from "lucide-react";
import type { ExtraAnswer } from "@/lib/api";
import { uid } from "./resumeDraft";

export function ExtraAnswers({
  value,
  onSave,
  saving,
}: {
  value: ExtraAnswer[] | null;
  onSave: (items: ExtraAnswer[]) => void;
  saving: boolean;
}) {
  const [items, setItems] = useState<ExtraAnswer[]>([]);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setItems(Array.isArray(value) ? value : []);
    setDirty(false);
  }, [value]);

  const mutate = (next: ExtraAnswer[]) => {
    setItems(next);
    setDirty(true);
  };
  const update = (id: string, patch: Partial<ExtraAnswer>) =>
    mutate(items.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  const remove = (id: string) => mutate(items.filter((it) => it.id !== id));
  const add = () =>
    mutate([...items, { id: uid("qa"), question: "", answer: "" }]);

  return (
    <div className="rounded-2xl border border-border bg-card p-6 shadow-sm space-y-4">
      <div className="flex items-start gap-3">
        <div className="p-3 bg-primary/10 text-primary rounded-xl">
          <MessagesSquare className="w-6 h-6" />
        </div>
        <div className="flex-1">
          <h3 className="font-semibold text-lg">Saved answers</h3>
          <p className="text-sm text-muted-foreground">
            Answers to recurring application questions. These build up over time
            and are reused so your applications stay consistent.
          </p>
        </div>
      </div>

      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground italic border-t border-border pt-4">
          No saved answers yet. Add one now, or they&rsquo;ll be captured
          automatically as you work through applications.
        </p>
      ) : (
        <div className="space-y-3 border-t border-border pt-4">
          {items.map((it) => (
            <div
              key={it.id}
              className="rounded-xl border border-border bg-muted/20 p-3 space-y-2"
            >
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Question</Label>
                <Input
                  value={it.question}
                  onChange={(e) => update(it.id, { question: e.target.value })}
                  placeholder="e.g. Why do you want to work here?"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Answer</Label>
                <Textarea
                  value={it.answer}
                  onChange={(e) => update(it.id, { answer: e.target.value })}
                  className="min-h-[70px]"
                />
              </div>
              <div className="flex justify-end">
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  onClick={() => remove(it.id)}
                >
                  <Trash2 className="w-4 h-4 mr-1" /> Delete
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" className="rounded-lg" onClick={add}>
          <Plus className="w-4 h-4 mr-1" /> Add question
        </Button>
        <Button
          size="sm"
          className="rounded-lg"
          onClick={() => onSave(items)}
          disabled={!dirty || saving}
        >
          <Save className="w-4 h-4 mr-1" /> {saving ? "Saving…" : "Save answers"}
        </Button>
      </div>
    </div>
  );
}
