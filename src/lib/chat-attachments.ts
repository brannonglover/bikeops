import type { ImagePickerAsset } from "expo-image-picker";

export type PendingChatImage = {
  localId: string;
  /** Server attachment id; null while uploading */
  id: string | null;
  previewUri: string;
  url: string | null;
  filename: string;
  status: "uploading" | "ready" | "failed";
};

export function buildPendingChatImage(asset: ImagePickerAsset): {
  pending: PendingChatImage;
  formData: FormData;
} {
  const isHeic =
    asset.mimeType === "image/heic" || asset.mimeType === "image/heif";
  const mimeType = isHeic ? "image/jpeg" : (asset.mimeType ?? "image/jpeg");
  const fileName = isHeic
    ? (asset.fileName?.replace(/\.heic$/i, ".jpg").replace(/\.heif$/i, ".jpg") ??
      "photo.jpg")
    : (asset.fileName ?? "photo.jpg");

  const formData = new FormData();
  formData.append("file", {
    uri: asset.uri,
    type: mimeType,
    name: fileName,
  } as unknown as Blob);

  return {
    pending: {
      localId: `local-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      id: null,
      previewUri: asset.uri,
      url: null,
      filename: fileName,
      status: "uploading",
    },
    formData,
  };
}

export function pendingChatImageDisplayUri(image: PendingChatImage): string {
  return image.previewUri;
}

export function isPendingChatImageReady(image: PendingChatImage): boolean {
  return image.status === "ready" && !!image.id;
}

export function hasUploadingPendingImages(images: PendingChatImage[]): boolean {
  return images.some((img) => img.status === "uploading");
}
