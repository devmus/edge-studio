import { DetailList, DetailRow } from "../../components/patterns/DetailList";
import { ErrorDetailPanel } from "../../components/patterns/ErrorDetailPanel";
import { JsonPreviewContent } from "../../components/JsonPreview";
import { Disclosure } from "../../components/ui/Disclosure";
import { Modal } from "../../components/ui/Modal";
import { Pill } from "../../components/ui/Pill";
import { formatLocalDateTime } from "../../lib/time";
import { formatRunDuration, RUN_STATUS } from "./automationRunDisplay";
import type { AutomationRun } from "./automationTypes";
import { CustomCodeRunJob } from "./workflow/CustomCodeRunJob";

/** Prefer the run-level error; if missing, fall back to the first failed block's error. */
function primaryInspectError(run: AutomationRun) {
  if (run.errorDetails ?? run.error) return run.errorDetails ?? run.error;
  const failedBlock = run.blocks.find((block) => block.error || block.status === "failed");
  return failedBlock?.errorDetails ?? failedBlock?.error ?? null;
}

/** Eye-action inspect dialog for one workflow run (opened from AutomationRunsTable). */
export function AutomationRunInspectModal({
  run,
  onClose,
}: {
  run: AutomationRun;
  onClose: () => void;
}) {
  const error = primaryInspectError(run);
  const failedBlocks = run.blocks.filter((block) => block.error || block.status === "failed");
  const failedBlock = failedBlocks[0];
  const successBlocks = run.blocks.filter((block) => block.status === "success").length;
  const status = RUN_STATUS[run.status];
  const scriptBlocks = run.blocks.filter((block) => block.blockType === "run_custom_code");

  return (
    <Modal title={`${run.workflowName} workflow`} onClose={onClose}>
      <div className="gap-detail-near grid">
        <DetailList>
          <DetailRow label="Started" value={formatLocalDateTime(run.startedAt)} />
          {run.outcome === "no_action" ? (
            <>
              <DetailRow label="Activity" value="No action required" />
              <DetailRow label="Scheduled checks" value={String(run.occurrenceCount ?? 1)} />
              <DetailRow label="Latest check" value={formatLocalDateTime(run.lastOccurrenceAt ?? run.startedAt)} />
            </>
          ) : null}
          <DetailRow label="Trigger" value={<Pill>{run.triggerType}</Pill>} />
          <DetailRow
            label="Status"
            value={
              <Pill tone={status.tone} indicator>
                {status.label}
              </Pill>
            }
          />
          <DetailRow label="Duration" value={formatRunDuration(run.durationMs)} />
          <DetailRow label="Blocks" value={`${successBlocks}/${run.blockCount}`} />
          {failedBlock ? <DetailRow label="Failed block" value={failedBlock.blockLabel} /> : null}
        </DetailList>

        {run.outcome === "no_action" && (run.occurrenceCount ?? 1) > 1 ? (
          <p className="type-body text-text-secondary m-0">
            Block details represent the first check in this group. Later equivalent scheduled checks were compacted because their condition stopped before any action.
          </p>
        ) : null}

        {error ? (
          <Disclosure title="Error">
            <ErrorDetailPanel error={error} />
          </Disclosure>
        ) : null}

        {failedBlocks.length > 0 ? (
          <Disclosure title="Block errors">
            <div className="border-stroke-secondary divide-stroke-secondary flex flex-col divide-y">
              {failedBlocks.map((block) => {
                const blockError = block.errorDetails ?? block.error;
                return blockError ? (
                  <div
                    key={block.id}
                    className="py-pad-close flex flex-col first:pt-0 last:pb-0"
                  >
                    <ErrorDetailPanel error={blockError} />
                  </div>
                ) : null;
              })}
            </div>
          </Disclosure>
        ) : null}

        {scriptBlocks.length > 0 && <Disclosure title="Script jobs">
          {scriptBlocks.map((block) => <div key={block.id} className="gap-detail-next grid py-pad-close">
            <strong>{block.blockLabel}</strong>
            <CustomCodeRunJob key={block.id} blockRun={block} />
          </div>)}
        </Disclosure>}
        <Disclosure title="Block execution details" defaultOpen={false}>
          {run.blocks.map((block) => <Disclosure key={block.id} title={`${block.order}. ${block.blockLabel} · ${block.status}`} defaultOpen={false}>
            <div className="gap-detail-next grid">
              <strong>Recorded configuration</strong>
              <JsonPreviewContent value={block.config ?? {}} />
              {block.input != null && <><strong>Received input</strong><JsonPreviewContent value={block.input} /></>}
              {block.output != null && <><strong>Recorded result</strong><JsonPreviewContent value={block.output} /></>}
            </div>
          </Disclosure>)}
        </Disclosure>
        <Disclosure title="Run data">
          <JsonPreviewContent value={run} />
        </Disclosure>
      </div>
    </Modal>
  );
}
