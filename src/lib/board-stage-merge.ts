import type { Job, JobBike, Stage } from "@/lib/types";

/** Board column order — keep a forward stage when a slow GET returns an older stage. */
export const BOARD_STAGE_FLOW: Stage[] = [
  "PENDING_APPROVAL",
  "BOOKED_IN",
  "RECEIVED",
  "WORKING_ON",
  "WAITING_ON_CUSTOMER",
  "WAITING_ON_PARTS",
  "BIKE_READY",
  "COMPLETED",
];

function boardStageIndex(stage: Stage): number {
  return BOARD_STAGE_FLOW.indexOf(stage);
}

/** Drop working-on when it points at a missing or completed bike. */
export function sanitizeWorkingOnJobBikeId(
  workingOnJobBikeId: string | null | undefined,
  jobBikes: JobBike[] | undefined
): string | null {
  if (!workingOnJobBikeId) return null;
  const bike = jobBikes?.find((b) => b.id === workingOnJobBikeId);
  if (!bike || bike.completedAt) return null;
  return workingOnJobBikeId;
}

function finalizeJobBoardState(job: Job): Job {
  if (job.stage === "BIKE_READY" || job.stage === "COMPLETED") {
    if (job.workingOnJobBikeId == null) return job;
    return { ...job, workingOnJobBikeId: null };
  }

  const workingOnJobBikeId = sanitizeWorkingOnJobBikeId(
    job.workingOnJobBikeId,
    job.jobBikes
  );
  if (workingOnJobBikeId === job.workingOnJobBikeId) return job;
  return { ...job, workingOnJobBikeId };
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
    } else if (!liveBike.waitingOnPartsAt && incomingBike.waitingOnPartsAt) {
      // Optimistic resume-work cleared waiting before the PATCH response landed.
      next = { ...next, waitingOnPartsAt: null };
      changed = true;
    } else if (liveBike.waitingOnPartsAt && !incomingBike.waitingOnPartsAt) {
      // Optimistic wait-for-parts ahead of a stale GET.
      next = { ...next, waitingOnPartsAt: liveBike.waitingOnPartsAt };
      changed = true;
    }

    return next;
  });

  return changed ? merged : incomingBikes;
}

/** Prefer live working-on selection when a stale GET omitted or regressed it. */
function mergeWorkingOnJobBikeId(
  live: Job,
  incoming: Job,
  jobBikes: JobBike[] | undefined
): string | null {
  const bikes = jobBikes ?? incoming.jobBikes ?? live.jobBikes;

  if (live.workingOnJobBikeId === incoming.workingOnJobBikeId) {
    return sanitizeWorkingOnJobBikeId(incoming.workingOnJobBikeId, bikes);
  }
  if (live.workingOnJobBikeId != null && incoming.workingOnJobBikeId == null) {
    return sanitizeWorkingOnJobBikeId(live.workingOnJobBikeId, bikes);
  }
  if (live.workingOnJobBikeId != null && incoming.workingOnJobBikeId != null) {
    const liveSanitized = sanitizeWorkingOnJobBikeId(live.workingOnJobBikeId, bikes);
    if (liveSanitized != null) return liveSanitized;
    return sanitizeWorkingOnJobBikeId(incoming.workingOnJobBikeId, bikes);
  }
  return sanitizeWorkingOnJobBikeId(incoming.workingOnJobBikeId, bikes);
}

function mergeJobBikeState(
  live: Job,
  incoming: Job,
  overrides: Partial<Job> = {}
): Job {
  const preliminaryWorkingOn = live.workingOnJobBikeId ?? incoming.workingOnJobBikeId;
  const jobBikes = mergeForwardJobBikes(
    live.jobBikes,
    incoming.jobBikes,
    preliminaryWorkingOn
  );
  const workingOnJobBikeId = mergeWorkingOnJobBikeId(live, incoming, jobBikes);

  return finalizeJobBoardState({
    ...incoming,
    ...overrides,
    workingOnJobBikeId,
    ...(jobBikes ? { jobBikes } : {}),
  });
}

function mergeSameStageJob(live: Job, incoming: Job): Job {
  const preliminaryWorkingOn = live.workingOnJobBikeId ?? incoming.workingOnJobBikeId;
  const jobBikes = mergeForwardJobBikes(
    live.jobBikes,
    incoming.jobBikes,
    preliminaryWorkingOn
  );
  const workingOnJobBikeId = mergeWorkingOnJobBikeId(live, incoming, jobBikes);

  if (
    workingOnJobBikeId === incoming.workingOnJobBikeId &&
    jobBikes === incoming.jobBikes
  ) {
    return finalizeJobBoardState(incoming);
  }

  return mergeJobBikeState(live, incoming);
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
    const preliminaryWorkingOn = live.workingOnJobBikeId ?? incoming.workingOnJobBikeId;
    const resumedWork =
      live.stage === "WORKING_ON" &&
      incoming.stage === "WAITING_ON_PARTS" &&
      preliminaryWorkingOn != null;

    return mergeJobBikeState(live, incoming, {
      stage: resumedWork ? live.stage : incoming.stage,
    });
  }

  return mergeJobBikeState(live, incoming, {
    stage: live.stage,
    completedAt: live.completedAt ?? incoming.completedAt,
  });
}
