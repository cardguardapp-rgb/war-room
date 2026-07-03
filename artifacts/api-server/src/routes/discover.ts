import { Router, type IRouter } from "express";

const router: IRouter = Router();

router.get("/discover/search", (_req, res): void => {
  res.json({
    results: [],
    message: "Discovery search is not implemented yet",
  });
});

export default router;
