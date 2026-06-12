import type { Job, Stage } from "@/lib/types";

/** Board column order — keep a forward stage when a slow GET returns an older stage. */
export const BOARD_STAGE_FLOW: Stage[] = [
  "PENDING_APPROVAL",
  "BOOKED_IN",
  "RECEIVED",
  "WORKING_ON",
  "WAITING_ON_PARTS",
  "BIKE_READY",
  "COMPLETED",
];

function boardStageIndex(stage: Stage): number {
  return BOARD_STAGE_FLOW.indexOf(stage);
}

/**
 * When the board already shows a later column than an incoming payload (optimistic
 * PATCH or a GET that started before the PATCH), keep the forward stage on the job.
 */
export function keepForwardBoardStage(live: Job, incoming: Job): Job {
  if (live.stage === incoming.stage) return incoming;

  const liveIdx = boardStageIndex(live.stage);
  const incomingIdx = boardStageIndex(incoming.stage);
  if (liveIdx === -1 || incomingIdx === -1 || liveIdx <= incomingIdx) {
    return incoming;
  }

  return {
    ...incoming,
    stage: live.stage,
    completedAt: live.completedAt ?? incoming.completedAt,
    workingOnJobBikeId: live.workingOnJobBikeId,
  };
}
