// Interview prep pack normaliser (no keys, no DB).
// Run: pnpm --filter @workspace/api-server exec tsx test/interviewPrepTest.ts
import assert from "node:assert";
import { normaliseInterviewPrep } from "../src/lib/interviewPrep";

const pack = normaliseInterviewPrep({
  stories: [
    { id: "s1", title: "Onboarding rebuild", situation: " Churn in week one ", action: "Led it", result: "Fewer drop-offs", metric: "", source: "Resume" },
    { id: "s1", title: "Pricing review", situation: "x", action: "y", result: "z", metric: "12% uplift", source: "Saved answer" },
    { id: "s9", title: "", situation: "", action: "", result: "", metric: null },
    "not an object",
  ],
  questions: [
    { id: "q1", question: "Tell me about a turnaround.", story_id: "s1", angle: "Lead with the churn" },
    { question: "Pricing?", story_id: "Pricing review" },
    { id: "q3", question: "Unknown story", story_id: "s42" },
    { id: "q4", question: "   " },
  ],
  gaps: [{ requirement: "SQL", gap: "No SQL on record", how_to_handle: "Say so" }, {}],
  questions_to_ask: [{ question: "What does success look like at 90 days?", why: "Sets the bar" }],
});

// Blank metric → null; duplicate id renumbered; empty story and non-object dropped.
assert.strictEqual(pack.stories.length, 2);
assert.strictEqual(pack.stories[0].metric, null);
assert.strictEqual(pack.stories[0].situation, "Churn in week one");
assert.strictEqual(pack.stories[1].metric, "12% uplift");
assert.notStrictEqual(pack.stories[0].id, pack.stories[1].id);
console.log("OK  stories cleaned (blank metric → null, unique ids, empties dropped)");

// Questions: kept id link, title link resolved, unknown link blanked, empty dropped.
assert.strictEqual(pack.questions.length, 3);
assert.strictEqual(pack.questions[0].story_id, "s1");
assert.strictEqual(pack.questions[1].story_id, pack.stories[1].id);
assert.strictEqual(pack.questions[2].story_id, "");
assert.ok(pack.questions[1].id && pack.questions[1].id !== "q1");
console.log("OK  questions point at real stories (by id or title), unknown links blanked");

assert.strictEqual(pack.gaps.length, 1);
assert.strictEqual(pack.questions_to_ask.length, 1);
assert.deepStrictEqual(normaliseInterviewPrep(null), { stories: [], questions: [], gaps: [], questions_to_ask: [] });
console.log("OK  gaps / questions to ask cleaned; null input → empty pack");
