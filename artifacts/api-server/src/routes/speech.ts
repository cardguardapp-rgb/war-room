import { Router, type IRouter } from "express";
import { mintStreamingToken, SpeechError } from "../lib/speech";

const router: IRouter = Router();

// A short-lived AssemblyAI streaming token for the browser (behind the PIN).
// The API key never leaves the server; the response carries only the token
// inside the WebSocket URL. Neither is logged.
router.post("/speech/token", async (req, res): Promise<void> => {
  try {
    const token = await mintStreamingToken();
    req.log.info(
      { expiresInSeconds: token.expires_in_seconds, maxSessionSeconds: token.max_session_seconds },
      "Speech token minted",
    );
    res.json(token);
  } catch (err) {
    const status = err instanceof SpeechError ? err.status : 502;
    const message = err instanceof SpeechError ? err.message : "Couldn't start speech-to-text.";
    req.log.error({ err: err instanceof SpeechError ? err.message : err }, "Speech token failed");
    res.status(status).json({ error: message });
  }
});

export default router;
