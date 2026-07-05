import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { NotebookPen, Save } from "lucide-react";

export function AdditionalContext({
  value,
  onSave,
  saving,
}: {
  value: string | null;
  onSave: (text: string) => void;
  saving: boolean;
}) {
  const [text, setText] = useState("");
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setText(value ?? "");
    setDirty(false);
  }, [value]);

  return (
    <div className="rounded-2xl border border-border bg-card p-6 shadow-sm space-y-4">
      <div className="flex items-start gap-3">
        <div className="p-3 bg-primary/10 text-primary rounded-xl">
          <NotebookPen className="w-6 h-6" />
        </div>
        <div className="flex-1">
          <h3 className="font-semibold text-lg">Additional context</h3>
          <p className="text-sm text-muted-foreground">
            Anything important that doesn&rsquo;t fit neatly in your resume —
            career goals, availability, visa status, salary expectations, or
            other background worth keeping in mind when tailoring applications.
          </p>
        </div>
      </div>

      <Textarea
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setDirty(true);
        }}
        placeholder="e.g. Open to relocating for the right role. Currently on a 3-month notice period. Prefer remote-first teams…"
        className="min-h-[140px] border-t border-border pt-4"
      />

      <div className="flex justify-end">
        <Button
          size="sm"
          className="rounded-lg"
          onClick={() => onSave(text)}
          disabled={!dirty || saving}
        >
          <Save className="w-4 h-4 mr-1" /> {saving ? "Saving…" : "Save context"}
        </Button>
      </div>
    </div>
  );
}
