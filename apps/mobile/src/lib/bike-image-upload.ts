import type { ImagePickerAsset } from "expo-image-picker";
import { api } from "@/lib/api";
import type { Job } from "@/lib/types";

export function buildBikeImageFormData(asset: ImagePickerAsset): FormData {
  const rawMime = asset.mimeType?.trim() || "";
  const isHeic =
    rawMime === "image/heic" ||
    rawMime === "image/heif" ||
    /\.(heic|heif)$/i.test(asset.fileName ?? "");
  const mimeType = isHeic || !rawMime ? "image/jpeg" : rawMime;
  const fileName = isHeic
    ? (asset.fileName?.replace(/\.heic$/i, ".jpg").replace(/\.heif$/i, ".jpg") ??
      "photo.jpg")
    : (asset.fileName?.trim() || "photo.jpg");

  const formData = new FormData();
  formData.append("file", {
    uri: asset.uri,
    type: mimeType,
    name: fileName,
  } as unknown as Blob);

  return formData;
}

export async function uploadBikeImage(asset: ImagePickerAsset): Promise<string> {
  const formData = buildBikeImageFormData(asset);
  const { data } = await api.postForm<{ url: string }>("/api/bikes/upload", formData);
  if (!data.url) {
    throw new Error("Upload did not return an image URL");
  }
  return data.url;
}

type UpdateJobBikeImageUrlBody = {
  updateJobBikeImageUrl: {
    jobBikeId: string;
    imageUrl: string;
  };
};

export async function updateJobBikeImage(
  jobId: string,
  jobBikeId: string,
  imageUrl: string
): Promise<Job> {
  const { data } = await api.patch<Job>(`/api/jobs/${jobId}`, {
    updateJobBikeImageUrl: { jobBikeId, imageUrl },
  } satisfies UpdateJobBikeImageUrlBody);
  return data;
}
