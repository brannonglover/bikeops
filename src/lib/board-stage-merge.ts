import type { Job, JobBike, Stage } from "@/lib/types";

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

function mergeForwardJobBikes(
  liveBikes: JobBike[] | undefined,
  incomingBikes: JobBike[] | undefined,
  workingOnJobBikeId: string | null | undefined
): JobBike[] | undefined {
  if (!liveBikes?.length || !incomingBikes?.length) return incomingBikes;

  let changed = false;
  const merged = incomingBikes.map((incomingBike) => {
    const liveBike = liveBikes.find((b) => b.id === incomingBike.id);
    if (!liveBike) return incomingBike;

    let next = incomingBike;

    if (liveBike.completedAt && !incomingBike.completedAt) {
      next = { ...next, completedAt: liveBike.completedAt, waitingOnPartsAt: null };
      changed = true;
    } else if (
      liveBike.id === workingOnJobBikeId &&
      !liveBike.waitingOnPartsAt &&
      incomingBike.waitingOnPartsAt
    ) {
      next = { ...next, waitingOnPartsAt: null };
      changed = true;
    }

    return next;
  });

  return changed ? merged : incomingBikes;
}

/** Prefer live working-on selection when a stale GET omitted or regressed it. */
function mergeWorkingOnJobBikeId(live: Job, incoming: Job): string | null {
  if (live.workingOnJobBikeId === incoming.workingOnJobBikeId) {
    return incoming.workingOnJobBikeId;
  }
  if (live.workingOnJobBikeId != null && incoming.workingOnJobBikeId == null) {
    return live.workingOnJobBikeId;
  }
  if (live.workingOnJobBikeId != null && incoming.workingOnJobBikeId != null) {
    return live.workingOnJobBikeId;
  }
  return incoming.workingOnJobBikeId;
}

function mergeSameStageJob(live: Job, incoming: Job): Job {
  const workingOnJobBikeId = mergeWorkingOnJobBikeId(live, incoming);
  const jobBikes = mergeForwardJobBikes(live.jobBikes, incoming.jobBikes, workingOnJobBikeId);

  if (
    workingOnJobBikeId === incoming.workingOnJobBikeId &&
    jobBikes === incoming.jobBikes
  ) {
    return incoming;
  }

  return {
    ...incoming,
    workingOnJobBikeId,
    ...(jobBikes ? { jobBikes } : {}),
  };
}

/**
 * When the board already shows a later column than an incoming payload (optimistic
 * PATCH or a GET that started before the PATCH), keep the forward stage on the job.
 */
export function keepForwardBoardStage(live: Job, incoming: Job): Job {
  if (live.stage === incoming.stage) {
    return mergeSameStageJob(live, incoming);
  }

  const liveIdx = boardStageIndex(live.stage);
  const incomingIdx = boardStageIndex(incoming.stage);
  if (liveIdx === -1 || incomingIdx === -1 || liveIdx <= incomingIdx) {
    return incoming;
  }

  const workingOnJobBikeId = mergeWorkingOnJobBikeId(live, incoming);
  const jobBikes = mergeForwardJobBikes(live.jobBikes, incoming.jobBikes, workingOnJobBikeId);

  return {
    ...incoming,
    stage: live.stage,
    completedAt: live.completedAt ?? incoming.completedAt,
    workingOnJobBikeId,
    ...(jobBikes ? { jobBikes } : {}),
  };
}
