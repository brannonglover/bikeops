import type { QueryClient } from "@tanstack/react-query";
import { keepForwardBoardStage } from "@/lib/board-stage-merge";
import type { Job } from "@/lib/types";

const JOB_LIST_QUERY_KEYS = [["jobs"], ["jobs", "archived"]] as const;

/** Update a job in all known list caches (board, archive, etc.). */
export function updateJobInListCaches(queryClient: QueryClient, job: Job): void {
  for (const queryKey of JOB_LIST_QUERY_KEYS) {
    const prevJobs = queryClient.getQueryData<Job[]>(queryKey);
    if (prevJobs && Array.isArray(prevJobs)) {
      queryClient.setQueryData(
        queryKey,
        prevJobs.map((j) => (j.id === job.id ? keepForwardBoardStage(j, job) : j))
      );
    }
  }
}

/** Merge incoming job data into job + jobs list caches without regressing board stage. */
export function syncJobToCaches(
  queryClient: QueryClient,
  jobId: string,
  incoming: Job
): Job {
  const liveJob = queryClient.getQueryData<Job>(["job", jobId]);
  const merged = liveJob ? keepForwardBoardStage(liveJob, incoming) : incoming;

  queryClient.setQueryData(["job", jobId], merged);
  updateJobInListCaches(queryClient, merged);

  return merged;
}
