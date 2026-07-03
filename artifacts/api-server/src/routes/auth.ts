import { Router, type IRouter } from "express";
import {
  clearSessionCookie,
  hasValidSession,
  issueSessionCookie,
  verifyPin,
} from "../middlewares/pinAuth";

const router: IRouter = Router();

router.get("/auth/status", (req, res): void => {
  res.json({ authenticated: hasValidSession(req) });
});

router.post("/auth/login", (req, res): void => {
  const pin = req.body?.pin;
  if (typeof pin !== "string" || pin.length === 0) {
    res.status(400).json({ error: "PIN is required" });
    return;
  }

  if (!verifyPin(pin)) {
    req.log.warn("Incorrect PIN attempt");
    res.status(401).json({ error: "Incorrect PIN" });
    return;
  }

  issueSessionCookie(res);
  res.json({ authenticated: true });
});

router.post("/auth/logout", (_req, res): void => {
  clearSessionCookie(res);
  res.json({ authenticated: false });
});

export default router;
