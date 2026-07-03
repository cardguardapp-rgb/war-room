import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import profileRouter from "./profile";
import jobsRouter from "./jobs";
import documentsRouter from "./documents";
import generateRouter from "./generate";
import discoverRouter from "./discover";
import { requirePin } from "../middlewares/pinAuth";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(requirePin);
router.use(profileRouter);
router.use(jobsRouter);
router.use(documentsRouter);
router.use(generateRouter);
router.use(discoverRouter);

export default router;
