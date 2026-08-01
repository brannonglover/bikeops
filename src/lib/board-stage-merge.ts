import type { Job, JobBike, Stage } from "@/lib/types";

/** Board column order — ranking for merge uses {@link boardStageRank}. */
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

/** Working / waiting columns toggle sideways — not a strict forward progression. */
const IN_PROGRESS_STAGES = new Set<Stage>([
  "WORKING_ON",
  "WAITING_ON_CUSTOMER",
  "WAITING_ON_PARTS",
]);

/** Stages that never keep an active working-on bike pointer. */
const CLEARS_WORKING_ON = new Set<Stage>([
  "WAITING_ON_CUSTOMER",
  "WAITING_ON_PARTS",
  "BIKE_READY",
  "COMPLETED",
]);

function boardStageRank(stage: Stage): number {
  if (stage === "PENDING_APPROVAL") return 0;
  if (stage === "BOOKED_IN") return 1;
  if (stage === "RECEIVED") return 2;
  if (IN_PROGRESS_STAGES.has(stage)) return 3;
  if (stage === "BIKE_READY") return 4;
  if (stage === "COMPLETED") return 5;
  return -1;
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
  if (CLEARS_WORKING_ON.has(job.stage)) {
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
  opts?: { preserveLiveWaiting?: boolean }
): JobBike[] | undefined {
  if (!liveBikes?.length || !incomingBikes?.length) return incomingBikes;

  const preserveLiveWaiting = opts?.preserveLiveWaiting ?? false;

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
    } else if (
      preserveLiveWaiting &&
      liveBike.waitingOnPartsAt &&
      !incomingBike.waitingOnPartsAt
    ) {
      // Optimistic wait-for-parts ahead of a stale GET (only while still waiting).
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
  jobBikes: JobBike[] | undefined,
  stage: Stage
): string | null {
  if (CLEARS_WORKING_ON.has(stage)) return null;

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
  const stage = overrides.stage ?? incoming.stage;
  const jobBikes = mergeForwardJobBikes(live.jobBikes, incoming.jobBikes, {
    preserveLiveWaiting: stage === "WAITING_ON_PARTS",
  });
  const workingOnJobBikeId = mergeWorkingOnJobBikeId(
    live,
    incoming,
    jobBikes,
    stage
  );

  return finalizeJobBoardState({
    ...incoming,
    ...overrides,
    workingOnJobBikeId,
    ...(jobBikes ? { jobBikes } : {}),
  });
}

function mergeSameStageJob(live: Job, incoming: Job): Job {
  const jobBikes = mergeForwardJobBikes(live.jobBikes, incoming.jobBikes, {
    preserveLiveWaiting: live.stage === "WAITING_ON_PARTS",
  });
  const workingOnJobBikeId = mergeWorkingOnJobBikeId(
    live,
    incoming,
    jobBikes,
    live.stage
  );

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
 *
 * Waiting on parts/customer are peers of Working on — moving Waiting → Working must not
 * be treated as a regression (that snapped the app status back and hid updates on web).
 */
export function keepForwardBoardStage(live: Job, incoming: Job): Job {
  if (live.stage === incoming.stage) {
    return mergeSameStageJob(live, incoming);
  }

  const liveRank = boardStageRank(live.stage);
  const incomingRank = boardStageRank(incoming.stage);

  if (
    liveRank !== -1 &&
    incomingRank !== -1 &&
    liveRank === incomingRank &&
    IN_PROGRESS_STAGES.has(live.stage) &&
    IN_PROGRESS_STAGES.has(incoming.stage)
  ) {
    // Equal-timestamp fallback only: prefer the incoming peer stage so Working→Waiting
    // (and Waiting→Working) both apply. Stale polls are handled by {@link mergeBoardJob}.
    return mergeJobBikeState(live, incoming, { stage: incoming.stage });
  }

  if (liveRank === -1 || incomingRank === -1 || liveRank <= incomingRank) {
    return mergeJobBikeState(live, incoming, {
      stage: incoming.stage,
    });
  }

  return mergeJobBikeState(live, incoming, {
    stage: live.stage,
    completedAt: live.completedAt ?? incoming.completedAt,
  });
}

function parseJobUpdatedAtMs(job: Job): number | null {
  const ms = Date.parse(job.updatedAt);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Merge a polled/refetched job into what the client already shows. Newer updatedAt
 * always wins for stage and bike pointers; equal/unknown timestamps fall back to
 * {@link keepForwardBoardStage}.
 */
export function mergeBoardJob(live: Job, incoming: Job): Job {
  const liveMs = parseJobUpdatedAtMs(live);
  const incomingMs = parseJobUpdatedAtMs(incoming);

  if (liveMs !== null && incomingMs !== null) {
    if (incomingMs > liveMs) {
      return finalizeJobBoardState(incoming);
    }
    if (incomingMs < liveMs) {
      return finalizeJobBoardState({
        ...incoming,
        stage: live.stage,
        completedAt: live.completedAt,
        workingOnJobBikeId: live.workingOnJobBikeId,
        jobBikes: live.jobBikes ?? incoming.jobBikes,
      });
    }
  }

  return keepForwardBoardStage(live, incoming);
}
