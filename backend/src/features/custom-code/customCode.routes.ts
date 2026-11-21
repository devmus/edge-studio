import { Router } from "express";
import { requireRole } from "../auth/auth.middleware.js";
import { automationWriteRateLimiter } from "../auth/rate-limit.middleware.js";
import { dependencyUnavailable } from "../../shared/api-error.js";
import { getCustomCodeJob, listCustomCodeJobs, listCustomScripts, stopCustomCodeJob } from "./customCode.service.js";

export const customCodeRouter = Router();
customCodeRouter.use(requireRole("admin"), automationWriteRateLimiter);
customCodeRouter.get("/scripts", async (_req, res) => {
  try { res.json(await listCustomScripts()); }
  catch { dependencyUnavailable(res, "Script helper unavailable. Check the installed-script setup guide and runner service."); }
});
customCodeRouter.get("/jobs", async (req, res) => {
  try { res.json(await listCustomCodeJobs({
    workflowId: typeof req.query.workflowId === "string" ? req.query.workflowId : undefined,
    runId: typeof req.query.runId === "string" ? req.query.runId : undefined,
    blockId: typeof req.query.blockId === "string" ? req.query.blockId : undefined,
  })); }
  catch { dependencyUnavailable(res, "Script jobs are unavailable. Check the runner service."); }
});
customCodeRouter.get("/jobs/:id", async (req, res) => {
  try { res.json(await getCustomCodeJob(req.params.id)); }
  catch { dependencyUnavailable(res, "Script job is unavailable."); }
});
customCodeRouter.post("/jobs/:id/stop", async (req, res) => {
  try { res.json(await stopCustomCodeJob(req.params.id)); }
  catch { dependencyUnavailable(res, "Script job could not be stopped. Check the runner service."); }
});
