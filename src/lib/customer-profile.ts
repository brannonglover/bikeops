import * as SecureStore from "expo-secure-store";

const PROFILE_KEY = "customer_booking_profile";

export interface SavedBike {
  id: string;
  make: string;
  model: string;
}

export interface PastShop {
  subdomain: string;
  name: string;
  lastBookedAt: string;
}

export interface CustomerContact {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  address: string;
}

export interface CustomerProfile extends CustomerContact {
  imageUrl: string | null;
  bikes: SavedBike[];
  pastShops: PastShop[];
}

const EMPTY_PROFILE: CustomerProfile = {
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  address: "",
  imageUrl: null,
  bikes: [],
  pastShops: [],
};

function createId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function normalizeContact(contact: CustomerContact): CustomerContact {
  return {
    firstName: contact.firstName.trim(),
    lastName: contact.lastName.trim(),
    email: contact.email.trim(),
    phone: contact.phone.trim(),
    address: contact.address.trim(),
  };
}

function hasCompleteContact(contact: CustomerContact): boolean {
  const c = normalizeContact(contact);
  return Boolean(c.firstName && c.lastName && c.email && c.phone);
}

export function isContactComplete(contact: CustomerContact): boolean {
  return hasCompleteContact(contact);
}

async function readProfile(): Promise<CustomerProfile> {
  try {
    const raw = await SecureStore.getItemAsync(PROFILE_KEY);
    if (!raw) return { ...EMPTY_PROFILE, bikes: [], pastShops: [] };
    const parsed = JSON.parse(raw) as Partial<CustomerProfile>;
    return {
      firstName: typeof parsed.firstName === "string" ? parsed.firstName : "",
      lastName: typeof parsed.lastName === "string" ? parsed.lastName : "",
      email: typeof parsed.email === "string" ? parsed.email : "",
      phone: typeof parsed.phone === "string" ? parsed.phone : "",
      address: typeof parsed.address === "string" ? parsed.address : "",
      imageUrl:
        typeof parsed.imageUrl === "string" && parsed.imageUrl
          ? parsed.imageUrl
          : null,
      bikes: Array.isArray(parsed.bikes)
        ? parsed.bikes.filter(
            (b): b is SavedBike =>
              !!b &&
              typeof b.id === "string" &&
              typeof b.make === "string" &&
              typeof b.model === "string"
          )
        : [],
      pastShops: Array.isArray(parsed.pastShops)
        ? parsed.pastShops.filter(
            (s): s is PastShop =>
              !!s &&
              typeof s.subdomain === "string" &&
              typeof s.name === "string" &&
              typeof s.lastBookedAt === "string"
          )
        : [],
    };
  } catch {
    return { ...EMPTY_PROFILE, bikes: [], pastShops: [] };
  }
}

async function writeProfile(profile: CustomerProfile): Promise<void> {
  await SecureStore.setItemAsync(PROFILE_KEY, JSON.stringify(profile));
}

export async function getCustomerProfile(): Promise<CustomerProfile> {
  return readProfile();
}

export async function saveContact(contact: CustomerContact): Promise<CustomerProfile> {
  const profile = await readProfile();
  const next: CustomerProfile = {
    ...profile,
    ...normalizeContact(contact),
  };
  await writeProfile(next);
  return next;
}

export async function saveImageUrl(
  imageUrl: string | null
): Promise<CustomerProfile> {
  const profile = await readProfile();
  const next: CustomerProfile = { ...profile, imageUrl };
  await writeProfile(next);
  return next;
}

export async function upsertBike(
  make: string,
  model: string,
  existingId?: string | null
): Promise<{ profile: CustomerProfile; bike: SavedBike }> {
  const profile = await readProfile();
  const normalizedMake = make.trim();
  const normalizedModel = model.trim();

  if (existingId) {
    const idx = profile.bikes.findIndex((b) => b.id === existingId);
    if (idx >= 0) {
      const bike: SavedBike = {
        id: existingId,
        make: normalizedMake,
        model: normalizedModel,
      };
      const bikes = [...profile.bikes];
      bikes[idx] = bike;
      const next = { ...profile, bikes };
      await writeProfile(next);
      return { profile: next, bike };
    }
  }

  const match = profile.bikes.find(
    (b) =>
      b.make.toLowerCase() === normalizedMake.toLowerCase() &&
      b.model.toLowerCase() === normalizedModel.toLowerCase()
  );
  if (match) {
    return { profile, bike: match };
  }

  const bike: SavedBike = {
    id: createId("bike"),
    make: normalizedMake,
    model: normalizedModel,
  };
  const next = { ...profile, bikes: [...profile.bikes, bike] };
  await writeProfile(next);
  return { profile: next, bike };
}

export async function deleteBike(bikeId: string): Promise<CustomerProfile> {
  const profile = await readProfile();
  const next: CustomerProfile = {
    ...profile,
    bikes: profile.bikes.filter((b) => b.id !== bikeId),
  };
  await writeProfile(next);
  return next;
}

/** Cache shop CRM contact + bikes locally for booking / offline use. */
export async function syncProfileFromServer(data: {
  firstName: string;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  imageUrl?: string | null;
  bikes?: { id: string; make: string; model: string | null }[];
}): Promise<CustomerProfile> {
  const profile = await readProfile();
  const next: CustomerProfile = {
    ...profile,
    firstName: data.firstName.trim(),
    lastName: (data.lastName ?? "").trim(),
    email: (data.email ?? "").trim(),
    phone: (data.phone ?? "").trim(),
    address:
      data.address !== undefined
        ? (data.address ?? "").trim()
        : profile.address,
    imageUrl: data.imageUrl?.trim() || null,
    bikes: (data.bikes ?? []).map((b) => ({
      id: b.id,
      make: b.make,
      model: b.model?.trim() || "",
    })),
  };
  await writeProfile(next);
  return next;
}

export async function rememberShop(
  subdomain: string,
  name: string
): Promise<CustomerProfile> {
  const profile = await readProfile();
  const normalized = subdomain.trim().toLowerCase();
  const shopName = name.trim() || normalized;
  const pastShops = profile.pastShops.filter((s) => s.subdomain !== normalized);
  pastShops.unshift({
    subdomain: normalized,
    name: shopName,
    lastBookedAt: new Date().toISOString(),
  });
  const next = { ...profile, pastShops };
  await writeProfile(next);
  return next;
}
