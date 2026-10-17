import { createJson } from "./anthropic";
import { SKILL_GROUPING_SYSTEM } from "./prompts";
import { aiModel } from "./models";

export interface SkillGroup {
  label: string;
  items: string[];
}

interface RawGroupingResult {
  groups?: { label?: unknown; items?: unknown }[];
}

/**
 * Ask a fast/cheap model to sort a flat skills list into a handful of
 * labelled discipline groups, purely for layout — not a tailoring decision.
 * Falls back to returning `null` (caller should keep the flat list) if the
 * model response is unusable or every skill can't be accounted for, so a
 * grouping glitch never breaks a resume download.
 */
export async function groupSkills(items: string[]): Promise<SkillGroup[] | null> {
  if (items.length <= 3) return null; // Too few to bother grouping.

  const raw = await createJson<RawGroupingResult>({
    model: aiModel("skillGrouping"),
    system: SKILL_GROUPING_SYSTEM,
    user: JSON.stringify(items),
    maxTokens: 1024,
  });

  const groups = Array.isArray(raw?.groups) ? raw.groups : [];
  const cleaned: SkillGroup[] = groups
    .map((g) => ({
      label: typeof g.label === "string" ? g.label.trim() : "",
      items: Array.isArray(g.items) ? g.items.filter((s): s is string => typeof s === "string") : [],
    }))
    .filter((g) => g.label && g.items.length > 0);

  // Sanity check: every original skill must appear exactly once across the
  // groups. If the model dropped, duplicated, or reworded anything, bail out
  // to the flat fallback rather than show a mangled/lossy list.
  const flattened = cleaned.flatMap((g) => g.items);
  const sameSet =
    flattened.length === items.length && items.every((s) => flattened.includes(s));
  if (!sameSet) return null;

  return cleaned;
}
