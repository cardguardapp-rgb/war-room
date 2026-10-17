// Mock interview session logic + AI_MODEL_MOCK resolution (no keys, no DB).
// Run: pnpm --filter @workspace/api-server exec tsx test/mockInterviewTest.ts
import assert from "node:assert";
import {
  mockMessages,
  mockStage,
  mockSystemSuffix,
  newMockInterview,
  normaliseMockInterview,
  planFromPack,
} from "../src/lib/mockInterview";
import { normaliseInterviewPrep } from "../src/lib/interviewPrep";
import { aiModel } from "../src/lib/models";
import { CHAT_SYSTEM, MOCK_INTERVIEW_MODE } from "../src/lib/prompts";

const pack = normaliseInterviewPrep({
  stories: [{ id: "s1", title: "Onboarding rebuild", situation: "a", action: "b", result: "c", metric: "", source: "Resume" }],
  questions: [
    { id: "q1", question: "Tell me about a turnaround.", story_id: "s1" },
    { id: "q2", question: "How do you prioritise?", story_id: "s1" },
    { id: "q3", question: "A time you disagreed with a stakeholder?", story_id: "s1" },
  ],
  gaps: [],
  questions_to_ask: [],
});

// Plan: random, capped, no repeats.
const plan = planFromPack(pack, 5, () => 0.5);
assert.strictEqual(plan.length, 3);
assert.strictEqual(new Set(plan.map((p) => p.question_id)).size, 3);
assert.strictEqual(planFromPack(pack, 2).length, 2);
console.log("OK  plan picks distinct pack questions, capped at the pack size");

// Stages: ask → answer → ask … → done.
let s = newMockInterview(plan.slice(0, 2));
assert.deepStrictEqual(mockStage(s), { kind: "ask", index: 0 });
s.turns.push({ asked: "Q1?", answer: "", answer_seconds: null, answer_words: null, feedback: "" });
assert.deepStrictEqual(mockStage(s), { kind: "answer", index: 0 });
s.turns[0] = { ...s.turns[0], answer: "My answer", answer_seconds: 95, answer_words: 2, feedback: "Structure: good" };
assert.deepStrictEqual(mockStage(s), { kind: "ask", index: 1 });
s.turns.push({ asked: "Q2?", answer: "Second", answer_seconds: 30, answer_words: 1, feedback: "" });
assert.deepStrictEqual(mockStage(s), { kind: "answer", index: 1 });
console.log("OK  stages move ask → answer → ask");

// Messages alternate user/assistant and end on the right user message.
const msgs = mockMessages(s, { kind: "answer", index: 1 });
assert.strictEqual(msgs.length, 7);
msgs.forEach((m, i) => assert.strictEqual(m.role, i % 2 === 0 ? "user" : "assistant"));
assert.ok(String(msgs[0].content).startsWith("[APP] Put question 1 of 2"));
assert.ok(String(msgs[6].content).startsWith("[ANSWER] (30 seconds, 1 words)"));
const askMsgs = mockMessages(s, { kind: "ask", index: 1 });
assert.strictEqual(askMsgs.length, 5);
assert.ok(String(askMsgs[4].content).includes("question 2 of 2"));
console.log("OK  conversation alternates and ends on the ask / the answer");

// The mode instruction is appended; CHAT_SYSTEM isn't touched.
const suffix = mockSystemSuffix(pack);
assert.ok(suffix.includes(MOCK_INTERVIEW_MODE));
assert.ok(!suffix.includes(CHAT_SYSTEM.slice(0, 60)));
console.log("OK  mock mode + prep pack are a suffix to the coach prompt");

// Normaliser: bad shapes, unanswered turns beyond the plan, oversize answers.
const n = normaliseMockInterview({
  status: "weird",
  plan: [{ question_id: "q1", question: "Q?" }, { question: "" }, "x"],
  turns: [
    { asked: "Q?", answer: "a".repeat(30000), answer_seconds: -4, feedback: "ok" },
    { asked: "extra", answer: "" },
  ],
});
assert.strictEqual(n.status, "in_progress");
assert.strictEqual(n.plan.length, 1);
assert.strictEqual(n.turns.length, 1);
assert.strictEqual(n.turns[0].answer.length, 20000);
assert.strictEqual(n.turns[0].answer_seconds, null);
console.log("OK  normaliser bounds the session");

// AI_MODEL_MOCK: unset follows AI_MODEL_CHAT (env or default); set wins.
delete process.env.AI_MODEL_MOCK;
delete process.env.AI_MODEL_CHAT;
assert.strictEqual(aiModel("mock"), aiModel("chat"));
process.env.AI_MODEL_CHAT = "chat-model-x";
assert.strictEqual(aiModel("mock"), "chat-model-x");
process.env.AI_MODEL_MOCK = "mock-model-y";
assert.strictEqual(aiModel("mock"), "mock-model-y");
assert.strictEqual(aiModel("chat"), "chat-model-x");
console.log("OK  AI_MODEL_MOCK defaults to the chat model and overrides independently");
