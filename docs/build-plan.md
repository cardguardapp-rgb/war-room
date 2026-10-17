# War Room build plan

Milestones M0–M8. Tick a box only when every check under it passes. Each
milestone ends with a commit; pushing waits until Amy says push. The working
rules in `CLAUDE.md` apply throughout, in particular: no schema changes (new data
goes in `documents`), `CHAT_SYSTEM` unchanged, never touch the production
database, Australian English, and no fabricated experience, metrics or
employers.

---

## [x] M0: Run locally on Windows

**Scope**
- Load `.env` in development only, for both the API server and
  `lib/db/drizzle.config.ts`. Production keeps reading Replit Secrets.
- Vite dev proxy: `/api` → the local API server.
- `pnpm run dev:phone`: starts the API and the web app together, serves the web
  app over self-signed https on port **5175**, host `0.0.0.0` (reachable from the
  Fold6 on the local network), and prints **`War Room dev ready`** once both are
  up.
- Replit-only Vite plugins (`runtime-error-modal`, `cartographer`,
  `dev-banner`) stay off locally. Replit behaviour is unchanged.
- Storage: a local-disk driver behind the same `objectStore.ts` interface,
  chosen automatically when the Replit storage sidecar isn't present. Its folder
  is gitignored. Production storage is unchanged.
- PDF: use `SOFFICE_PATH` when set, otherwise the existing pdf-lib fallback.
- Backup import script: loads the War Room backup zip (`data.json` +
  `files/…`) into **warroom-dev**. It refuses to run if `DATABASE_URL` isn't the
  warroom-dev database. It preserves ids (documents and qa_log use identity
  columns, so it inserts with `OVERRIDING SYSTEM VALUE` and resets the
  sequences). Stored files go into the local storage folder under their original
  keys.
- Stop tracking `artifacts/api-server/data/app.db`, the resume PDFs in
  `attached_assets/` and `exports/` in git. Before that, check nothing at runtime
  uses them. They stay on disk and go into `.gitignore`.

**Known limit:** the export zip doesn't include chat attachment files or the
website config (`website/config.json`). After import, the chat transcripts load
but old attachments won't re-send, and the Website page starts from defaults.

**Checks (Amy)**
- `pnpm run dev:phone` prints `War Room dev ready`.
- The laptop opens `https://localhost:5175`. The Fold6 opens
  `https://<laptop-ip>:5175` on both screens after accepting the certificate.
- Log in with the PIN, and see the real jobs, profile and resume from the
  backup.
- Download a resume .docx and PDF locally (the PDF works without LibreOffice
  installed).
- Upload a chat attachment locally: it lands in the local storage folder, not on
  Replit.
- `git status` shows app.db, attached_assets/ and exports/ as untracked and
  ignored, and the files are still on disk.
- After deploying: the live app on Replit still works, with its data and file
  downloads intact.

---

## [x] M1: Security

**Scope**
- Login lockout after 5 wrong PINs, with a rising wait.
- Sessions carry their issue time and expire after 30 days, checked server-side.
- Logout clears the session.
- Rotating `SESSION_SECRET` logs out every device.
- The login screen accepts a 6–8 digit PIN.
- CORS limited to the app's own origin plus local dev.
- Standard security headers.

**Release note:** the PIN length changes with this release. `APP_PIN` in Replit
Secrets has to be set to a 6–8 digit value at the same time as the deploy, or
the live login won't match.

**Checks (Amy)**
- 5 wrong PINs lock the login, and the wait grows on repeated failures. The
  right PIN works once the wait is over.
- A 6, 7 and 8 digit PIN can be typed; 4 or 5 digits can't be submitted.
- Logging out, then pressing back or reloading, lands on the login screen.
- After changing `SESSION_SECRET` (and restarting), the laptop and the phone are
  both logged out.
- A session older than 30 days is rejected (shown with a test or a temporarily
  shortened expiry).
- The browser dev tools show the security headers on responses. A request from
  another origin is refused by CORS.

---

## [x] M2: Model settings and streaming

**Scope**
- Every model ID moves to its own environment variable per task:
  `AI_MODEL_EXTRACT`, `AI_MODEL_TAILOR`, `AI_MODEL_CHAT`, `AI_MODEL_DISCOVER`,
  `AI_MODEL_WEBSITE`. Defaults are today's values (`claude-sonnet-4-6` for
  extract/discover, `claude-opus-4-8` for tailor/chat/website). Ask before
  changing any default.
- A server-sent events (SSE) streaming helper, used first by the role chat so
  replies appear as they're written. It must be shown to work through the Replit
  deployment, not just locally.
- A faster role chat with `CHAT_SYSTEM` unchanged: stream the reply, keep the
  system prompt and grounding context cached, and log time to first word and
  total reply time for each message.
- A dev-only switch that sends the same question to the current model and a
  faster one side by side, so Amy can judge whether the faster model still
  sounds like the coach. Amy decides whether `AI_MODEL_CHAT` changes.

**Open question:** skill grouping (`SKILL_GROUPING_MODEL`, `claude-sonnet-4-6`)
isn't in the list. It needs either its own variable or to share
`AI_MODEL_EXTRACT`. Ask Amy.

**Checks (Amy)**
- With no `AI_MODEL_*` set, every feature behaves as before.
- Setting one variable changes only that task's model, which shows in the logs.
- In the live app, the role chat reply appears word by word, and the saved
  transcript matches what was shown.
- The logs show time to first word and total time for each chat message, and
  the cache is being hit from the second message on.
- The side-by-side switch works locally and doesn't exist in production.
- `git diff` shows no change to `CHAT_SYSTEM`.

---

## [x] M3: Interview prep pack

**Scope**
- An Interview prep section on Job Detail that generates and saves a
  `documents` row with type `interview_prep`, containing:
  - 8–12 stories from Amy's real experience. Each has the situation, what Amy
    did, the result, one metric, and the posting requirement it answers.
  - 12–15 likely questions, each mapped to a story.
  - Gaps, flagged honestly.
  - Questions to ask them.
- Editable and regenerable.
- Grounded only in the resume, saved answers and the role chat. Where a story
  has no real metric, it says so instead of inventing one.

**Checks (Amy)**
- Generate a pack for a real role: every story, employer and metric can be
  traced to the resume, saved answers or the chat.
- Every question points to a story. The gaps are real gaps.
- Edit a story, reload, and the edit is kept. Regenerate replaces the pack.
- Works on the Fold6 cover (368px) and inner (707px) screens, light and dark.
- No helper text in the section (an (i) tooltip at most).

---

## [ ] M4: Mock interview (voice)

**Scope**
- Streaming speech-to-text through AssemblyAI. The server mints a short-lived
  token, so the API key never reaches the browser. Check AssemblyAI's current
  docs for the token and streaming API before writing any code.
- Microphone capture in the browser.
- The coach asks questions from the prep pack aloud using browser speech (an
  Australian voice when one is available), and transcribes Amy's answer live.
  After each answer it streams feedback on structure, specificity and length,
  and on whether a different story fitted better.
- Questions and feedback come from the same coach as the role chat:
  `CHAT_SYSTEM` unchanged, plus a short mock-interview mode instruction.
- Sessions saved as `documents` with type `mock_interview`.
- Works on the laptop and the Fold6.
- Model variable `AI_MODEL_MOCK`, defaulting to the same model as
  `AI_MODEL_CHAT`.

**Checks (Amy)**
- In the browser dev tools, the AssemblyAI key never appears in any request or
  response. Only a short-lived token does.
- A question is spoken aloud in an Australian voice where Chrome has one.
- The answer transcribes live. The feedback streams, sounds like the coach, and
  invents nothing.
- A finished session is saved and can be reopened.
- A full run works on the laptop (Chrome) and on the Fold6.

---

## [ ] M5: Live listen

**Scope**
- Laptop Chrome only.
- Two audio sources: Amy's microphone (Me) and a shared tab or the system audio
  (Interviewer), each streamed to speech-to-text separately.
- A live two-column transcript, and a latency readout (end of speech to final
  text).
- No AI yet. Nothing is stored unless Amy chooses to save.

**Checks (Amy)**
- During a test call (for example a YouTube interview in a shared tab plus
  talking into the mic), the two columns fill independently with the right
  speaker.
- The latency readout updates after each utterance and the figures are
  plausible.
- Close the page without saving, and nothing appears in the database.

---

## [ ] M6: Live cue cards

**Scope**
- When the interviewer finishes a question, stream a cue card from the same
  coach: `CHAT_SYSTEM` unchanged, plus a short cue-card mode instruction and the
  prep pack, all in a cached system prompt, on a fast model (`AI_MODEL_LIVE`).
- Before choosing the default: run the same five questions through the chat
  model, `claude-sonnet-5-5` and `claude-haiku-5-5`, and show the cards and
  timings side by side. Amy picks the fastest one that still sounds like the
  coach.
- Each card: at most 3 bullets, the story to use, one metric, under 25 words in
  total.
- Ignore small talk.
- A manual trigger and a skip, both with keyboard shortcuts.
- Big, calm, dark-friendly text.
- Show the time from the end of the question to the first line.

**Checks (Amy)**
- The side-by-side comparison of 5 questions × 3 models, with timings, has been
  reviewed and the default picked.
- In a test session, real questions produce a card and small talk doesn't.
- Every card is under 25 words with at most 3 bullets, names a real story and
  uses only a real metric.
- The shortcuts trigger and skip cards.
- The time-to-first-line readout is shown and acceptable.
- The cards are readable at a glance in dark mode on the laptop.

---

## [ ] M7: Debrief

**Scope**
- Optionally save the live transcript (`documents` type `interview`).
- A debrief of what landed, what was missed and what to follow up, plus a
  thank-you email draft. Both come from the same coach (`CHAT_SYSTEM`
  unchanged, plus a debrief mode instruction).
- Both feed `formatCoachingNotes` for that role, so later tailoring and cover
  letters can draw on them.
- A delete button for the transcript.

**Checks (Amy)**
- Save a transcript, generate the debrief and email, and both read like the
  coach, with nothing invented.
- A later cover letter or tailoring run for that role reflects the debrief.
- Delete removes the transcript (check it's gone after a reload).

---

## [ ] M8: Hardening

**Scope**
- A security review of every new endpoint.
- Speech tokens only for a logged-in session, with a short expiry.
- A daily cap on AI calls and on speech minutes, with usage shown.
- Clear handling of a denied microphone, a cancelled share and network drops
  (with reconnect).
- Smoke tests.
- `CLAUDE.md` updated.

**Checks (Amy)**
- The security review notes are read and every finding is fixed or accepted.
- Logged out, the speech token endpoint returns 401. A token stops working after
  its expiry.
- Hitting the daily cap gives a clear message, and today's usage is visible.
- Denying the microphone, cancelling the share, and switching wifi off and on
  mid-session each give a clear state, and the session reconnects after the
  drop.
- The smoke tests pass (against warroom-dev only).
- `CLAUDE.md` describes everything added in M0–M8.

---

## Open questions

- ~~**Skill grouping model (M2):** does skill grouping get its own variable or
  share `AI_MODEL_EXTRACT`?~~ **Decided:** its own, `AI_MODEL_SKILL_GROUPING`.
  Cover letters and application answers also got their own,
  `AI_MODEL_WRITING`, and the dev-only side by side uses
  `AI_MODEL_CHAT_COMPARE` (default `claude-sonnet-5-5`).
- **Dark mode:** `.dark` tokens exist in `index.css` but nothing applies them,
  so the app is light only. The light-and-dark rule for mobile screens needs a
  theme switch (probably following the system setting). When should that be
  built: in M0, or with the first new screen in M3?
