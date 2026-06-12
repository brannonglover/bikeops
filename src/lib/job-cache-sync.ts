import type { QueryClient } from "@tanstack/react-query";
import { keepForwardBoardStage } from "@/lib/board-stage-merge";
import type { Job } from "@/lib/types";

/** Merge incoming job data into job + jobs list caches without regressing board stage. */
export function syncJobToCaches(
  queryClient: QueryClient,
  jobId: string,
  incoming: Job
): Job {
  const liveJob = queryClient.getQueryData<Job>(["job", jobId]);
  const merged = liveJob ? keepForwardBoardStage(liveJob, incoming) : incoming;

  queryClient.setQueryData(["job", jobId], merged);

  const prevJobs = queryClient.getQueryData<Job[]>(["jobs"]);
  if (prevJobs && Array.isArray(prevJobs)) {
    queryClient.setQueryData(
      ["jobs"],
      prevJobs.map((j) =>
        j.id === merged.id ? keepForwardBoardStage(j, merged) : j
      )
    );
  }

  return merged;
}
