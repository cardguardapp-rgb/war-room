import type { ResumeJson, ResumeSection } from "@/lib/api";

// Flatten a section into readable lines for side-by-side comparison.
function sectionLines(sec: ResumeSection): string[] {
  switch (sec.kind) {
    case "contact":
      return [sec.name, sec.email, sec.phone, sec.location, ...sec.links, ...sec.otherLines].filter(
        Boolean,
      );
    case "summary":
      return [...sec.paragraphs].filter(Boolean);
    case "experience":
      return sec.items.flatMap((it) => [
        [it.title, it.company, it.dates, it.location].filter(Boolean).join(" · "),
        ...it.bullets.map((b) => `• ${b}`),
      ]);
    case "education":
      return sec.items.flatMap((it) => [
        [it.institution, it.qualification, it.dates, it.location].filter(Boolean).join(" · "),
        ...it.details.map((d) => `• ${d}`),
      ]);
    case "skills":
      return [...sec.items].filter(Boolean);
    case "other":
      return [...sec.paragraphs, ...sec.bullets.map((b) => `• ${b}`)].filter(Boolean);
    default:
      return [];
  }
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

function matchOriginal(
  sec: ResumeSection,
  original: ResumeSection[],
  used: Set<string>,
): ResumeSection | undefined {
  const byId = original.find((o) => o.id === sec.id && !used.has(o.id));
  if (byId) {
    used.add(byId.id);
    return byId;
  }
  const byKind = original.find((o) => o.kind === sec.kind && !used.has(o.id));
  if (byKind) {
    used.add(byKind.id);
    return byKind;
  }
  return undefined;
}

export function ResumeDiff({
  original,
  proposed,
}: {
  original: ResumeJson | null;
  proposed: ResumeJson;
}) {
  const originalSections = original?.sections ?? [];
  const used = new Set<string>();

  return (
    <div className="space-y-4">
      {proposed.sections.map((sec) => {
        const orig = matchOriginal(sec, originalSections, used);
        const pLines = sectionLines(sec);
        const oLines = orig ? sectionLines(orig) : [];
        const oSet = new Set(oLines.map(norm));
        const pSet = new Set(pLines.map(norm));

        return (
          <div
            key={sec.id}
            className="rounded-2xl border border-border bg-card overflow-hidden shadow-sm"
          >
            <div className="px-4 py-2 border-b border-border bg-muted/30 flex items-center gap-2">
              <span className="text-xs uppercase tracking-wide text-primary/80">
                {sec.kind}
              </span>
              <span className="text-sm font-medium truncate">{sec.heading}</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-border">
              <div className="p-4 space-y-1.5">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-2">
                  Original
                </p>
                {oLines.length === 0 ? (
                  <p className="text-sm text-muted-foreground italic">
                    {orig ? "—" : "(new section)"}
                  </p>
                ) : (
                  oLines.map((l, i) => (
                    <p
                      key={i}
                      className={`text-sm ${
                        pSet.has(norm(l))
                          ? "text-muted-foreground"
                          : "text-muted-foreground/60 line-through"
                      }`}
                    >
                      {l}
                    </p>
                  ))
                )}
              </div>
              <div className="p-4 space-y-1.5">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-2">
                  Tailored
                </p>
                {pLines.length === 0 ? (
                  <p className="text-sm text-muted-foreground italic">—</p>
                ) : (
                  pLines.map((l, i) => {
                    const changed = !oSet.has(norm(l));
                    return (
                      <p
                        key={i}
                        className={`text-sm rounded px-1 -mx-1 ${
                          changed
                            ? "bg-amber-100/70 dark:bg-amber-900/30 text-foreground"
                            : "text-foreground"
                        }`}
                      >
                        {l}
                      </p>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
