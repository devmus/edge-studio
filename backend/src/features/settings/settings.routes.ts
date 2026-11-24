import { Router } from "express";
import { requireRole } from "../auth/auth.middleware.js";
import { unexpected, validationFailed } from "../../shared/api-error.js";
import {
  DEVELOPER_DIAGNOSTICS_DURATIONS,
  DeveloperDiagnosticsValidationError,
  getDeveloperDiagnosticsSettings,
  saveDeveloperDiagnosticsSettings,
} from "./developerDiagnostics.service.js";

export const settingsRouter = Router();
settingsRouter.use(requireRole("admin"));

settingsRouter.get("/developer-diagnostics", (_req, res) => {
  res.json({
    settings: getDeveloperDiagnosticsSettings(),
    durationsMinutes: DEVELOPER_DIAGNOSTICS_DURATIONS,
  });
});

settingsRouter.post("/developer-diagnostics", (req, res) => {
  try {
    res.json({
      settings: saveDeveloperDiagnosticsSettings(req.body, req.user?.id),
      durationsMinutes: DEVELOPER_DIAGNOSTICS_DURATIONS,
    });
  } catch (error) {
    if (error instanceof DeveloperDiagnosticsValidationError)
      return validationFailed(res, error.message, error.fieldErrors);
    unexpected(res, "Developer diagnostics settings could not be saved.", error);
  }
});
