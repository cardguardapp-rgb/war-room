// Browser speech for the mock interview: the coach's questions are read aloud
// with the Web Speech API, in an Australian English voice when the browser has
// one (then British, then any English).

const synth = typeof window !== "undefined" ? window.speechSynthesis : undefined;

export const canSpeak = !!synth;

/** The browser's voices; Chrome loads them asynchronously, so wait briefly. */
function loadVoices(): Promise<SpeechSynthesisVoice[]> {
  if (!synth) return Promise.resolve([]);
  const now = synth.getVoices();
  if (now.length) return Promise.resolve(now);
  return new Promise((resolve) => {
    const done = () => {
      synth.removeEventListener("voiceschanged", done);
      resolve(synth.getVoices());
    };
    synth.addEventListener("voiceschanged", done);
    setTimeout(done, 1500);
  });
}

function langOf(v: SpeechSynthesisVoice): string {
  return v.lang.replace("_", "-").toLowerCase();
}

// Prefer the better-sounding network/neural voices within a language.
function quality(v: SpeechSynthesisVoice): number {
  return /natural|neural|online|google/i.test(v.name) ? 1 : 0;
}

function pickVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  for (const want of ["en-au", "en-gb", "en-"]) {
    const matches = voices
      .filter((v) => langOf(v).startsWith(want))
      .sort((a, b) => quality(b) - quality(a));
    if (matches.length) return matches[0];
  }
  return null;
}

let chosen: Promise<SpeechSynthesisVoice | null> | null = null;

/** The voice questions are read in (null: the browser default). */
export function coachVoice(): Promise<SpeechSynthesisVoice | null> {
  chosen ??= loadVoices().then(pickVoice);
  return chosen;
}

/** Read `text` aloud; resolves when it finishes or is stopped. */
export async function speak(text: string): Promise<void> {
  if (!synth || !text.trim()) return;
  const voice = await coachVoice();
  synth.cancel();
  return new Promise((resolve) => {
    const u = new SpeechSynthesisUtterance(text);
    if (voice) u.voice = voice;
    u.lang = voice?.lang ?? "en-AU";
    u.onend = () => resolve();
    u.onerror = () => resolve();
    synth.speak(u);
  });
}

export function stopSpeaking(): void {
  synth?.cancel();
}
