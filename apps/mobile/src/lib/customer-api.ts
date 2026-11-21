import type { ImagePickerAsset } from "expo-image-picker";
import { api } from "@/lib/api";
import { buildBikeImageFormData } from "@/lib/bike-image-upload";
import type { Bike, Customer, Job } from "@/lib/types";

export type ProfileBikeSource = {
  id: string;
  make: string;
  model: string;
  nickname?: string | null;
  imageUrl?: string | null;
};

function bikeKey(make: string, model: string | null | undefined): string {
  return `${make.trim().toLowerCase()}|${(model ?? "").trim().toLowerCase()}`;
}

/** Unique bikes from repair history (JobBike snapshots + legacy job fields). */
export function extractBikesFromJobs(jobs: Job[]): ProfileBikeSource[] {
  const byKey = new Map<string, ProfileBikeSource>();

  for (const job of jobs) {
    const rows = [...(job.jobBikes ?? [])].sort(
      (a, b) => a.sortOrder - b.sortOrder
    );

    if (rows.length > 0) {
      for (const jb of rows) {
        const make = (jb.bike?.make ?? jb.make)?.trim();
        if (!make) continue;
        const model = (jb.bike?.model ?? jb.model)?.trim() || "";
        const key = bikeKey(make, model);
        if (byKey.has(key)) {
          const prev = byKey.get(key)!;
          if (!prev.imageUrl) {
            prev.imageUrl = jb.bike?.imageUrl ?? jb.imageUrl ?? null;
          }
          continue;
        }
        byKey.set(key, {
          id: jb.bikeId ?? jb.bike?.id ?? `jobbike_${jb.id}`,
          make,
          model,
          nickname: jb.bike?.nickname ?? jb.nickname ?? null,
          imageUrl: jb.bike?.imageUrl ?? jb.imageUrl ?? null,
        });
      }
      continue;
    }

    const make = job.bikeMake?.trim();
    if (!make || make === "Multiple") continue;
    const model = job.bikeModel?.trim() || "";
    const key = bikeKey(make, model);
    if (byKey.has(key)) continue;
    byKey.set(key, {
      id: `job_${job.id}`,
      make,
      model,
      imageUrl: null,
    });
  }

  return Array.from(byKey.values()).sort((a, b) =>
    `${a.make} ${a.model}`.localeCompare(`${b.make} ${b.model}`)
  );
}

function mergeBikes(
  primary: ProfileBikeSource[],
  secondary: ProfileBikeSource[]
): ProfileBikeSource[] {
  const byKey = new Map<string, ProfileBikeSource>();
  // Secondary first, then primary so CRM / preferred rows win on conflict.
  for (const bike of [...secondary, ...primary]) {
    const key = bikeKey(bike.make, bike.model);
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, { ...bike });
      continue;
    }
    const prevSynthetic = prev.id.startsWith("job");
    const nextSynthetic = bike.id.startsWith("job");
    if (prevSynthetic && !nextSynthetic) {
      byKey.set(key, {
        ...bike,
        imageUrl: bike.imageUrl || prev.imageUrl || null,
      });
    } else if (!prev.imageUrl && bike.imageUrl) {
      prev.imageUrl = bike.imageUrl;
    }
  }
  return Array.from(byKey.values()).sort((a, b) =>
    `${a.make} ${a.model}`.localeCompare(`${b.make} ${b.model}`)
  );
}

function mapCustomerBikes(customer: Customer): ProfileBikeSource[] {
  return (customer.bikes ?? []).map((b) => ({
    id: b.id,
    make: b.make,
    model: b.model ?? "",
    nickname: b.nickname,
    imageUrl: b.imageUrl,
  }));
}

/** Fast path: contact + CRM bikes from /api/customer/me only. */
export async function loadCustomerMeData(): Promise<{
  customer: Customer | null;
  bikes: ProfileBikeSource[];
  synced: boolean;
}> {
  try {
    const customer = await fetchCustomerMe();
    return {
      customer,
      bikes: mapCustomerBikes(customer),
      synced: true,
    };
  } catch {
    // Profile endpoint may not be deployed yet — jobs still work.
    return { customer: null, bikes: [], synced: false };
  }
}

/**
 * Slower path: merge repair-history bikes from /api/customer/jobs, and
 * optionally backfill missing CRM rows. Call after loadCustomerMeData so the
 * UI can paint contact info first.
 */
export async function loadCustomerBikesFromJobs(options: {
  customer: Customer | null;
  bikes: ProfileBikeSource[];
  synced: boolean;
}): Promise<{
  customer: Customer | null;
  bikes: ProfileBikeSource[];
}> {
  let { customer, bikes, synced } = options;

  try {
    const { data: jobs } = await api.get<Job[]>("/api/customer/jobs", {
      role: "customer",
    });

    if (!customer && jobs[0]?.customer) {
      customer = jobs[0].customer;
    }

    const nestedBikes = (jobs[0]?.customer?.bikes ?? []).map((b) => ({
      id: b.id,
      make: b.make,
      model: b.model ?? "",
      nickname: b.nickname,
      imageUrl: b.imageUrl,
    }));

    const fromJobs = extractBikesFromJobs(jobs);
    bikes = mergeBikes(bikes, mergeBikes(nestedBikes, fromJobs));

    // Persist any history bikes missing from CRM when write APIs are available
    if (synced) {
      const existingKeys = new Set(
        bikes
          .filter((b) => !b.id.startsWith("job"))
          .map((b) => bikeKey(b.make, b.model))
      );
      let created = false;
      for (const bike of fromJobs) {
        const key = bikeKey(bike.make, bike.model);
        if (existingKeys.has(key)) continue;
        try {
          const saved = await createCustomerBike({
            make: bike.make,
            model: bike.model || null,
          });
          existingKeys.add(key);
          bikes = mergeBikes(
            [
              {
                id: saved.id,
                make: saved.make,
                model: saved.model ?? "",
                imageUrl: saved.imageUrl,
              },
            ],
            bikes
          );
          created = true;
        } catch {
          // Keep the job-derived row in the UI even if create fails
        }
      }
      if (created) {
        try {
          const refreshed = await fetchCustomerMe();
          customer = refreshed;
          bikes = mergeBikes(mapCustomerBikes(refreshed), bikes);
        } catch {
          // ignore
        }
      }
    }
  } catch {
    // ignore
  }

  return { customer, bikes };
}

/**
 * Load customer profile + bikes. Prefers /api/customer/me, and always merges
 * bikes from /api/customer/jobs so repair history shows up even when the CRM
 * bike list is empty or the profile endpoint is unavailable.
 */
export async function loadCustomerProfileData(): Promise<{
  customer: Partial<Customer> | null;
  bikes: ProfileBikeSource[];
  synced: boolean;
}> {
  const me = await loadCustomerMeData();
  const merged = await loadCustomerBikesFromJobs(me);
  return { ...merged, synced: me.synced };
}

export async function fetchCustomerMe(): Promise<Customer> {
  const { data } = await api.get<Customer>("/api/customer/me", {
    role: "customer",
  });
  return data;
}

export async function updateCustomerMe(
  body: Partial<{
    firstName: string;
    lastName: string | null;
    email: string | null;
    phone: string | null;
    address: string | null;
    imageUrl: string | null;
  }>
): Promise<Customer> {
  const { data } = await api.patch<Customer>("/api/customer/me", body, {
    role: "customer",
  });
  return data;
}

export async function createCustomerBike(body: {
  make: string;
  model?: string | null;
  nickname?: string | null;
}): Promise<Bike> {
  const { data } = await api.post<Bike>("/api/customer/bikes", body, {
    role: "customer",
  });
  return data;
}

export async function updateCustomerBike(
  bikeId: string,
  body: {
    make?: string;
    model?: string | null;
    nickname?: string | null;
  }
): Promise<Bike> {
  const { data } = await api.patch<Bike>(
    `/api/customer/bikes/${bikeId}`,
    body,
    { role: "customer" }
  );
  return data;
}

export async function deleteCustomerBike(bikeId: string): Promise<void> {
  await api.delete(`/api/customer/bikes/${bikeId}`, { role: "customer" });
}

export async function uploadCustomerPhoto(
  asset: ImagePickerAsset
): Promise<string> {
  const formData = buildBikeImageFormData(asset);
  const { data } = await api.postForm<{ url: string }>(
    "/api/customer/upload",
    formData,
    { role: "customer" }
  );
  if (!data.url) {
    throw new Error("Upload did not return an image URL");
  }
  return data.url;
}
