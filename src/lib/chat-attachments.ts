import type { ImagePickerAsset } from "expo-image-picker";
import {
  manipulateAsync,
  SaveFormat,
  type Action,
} from "expo-image-manipulator";

/** Match web chat: stay under Vercel's ~4.5 MB serverless body limit. */
const MAX_UPLOAD_DIM = 2048;
const JPEG_QUALITY = 0.8;

export type PendingChatImage = {
  localId: string;
  /** Server attachment id; null while uploading */
  id: string | null;
  previewUri: string;
  url: string | null;
  filename: string;
  status: "uploading" | "ready" | "failed";
};

function toJpegFileName(fileName: string | null | undefined): string {
  const raw = (fileName?.trim() || "photo").replace(/\.[^.]+$/, "") || "photo";
  return `${raw}.jpg`;
}

async function compressChatImage(asset: ImagePickerAsset): Promise<{
  uri: string;
  fileName: string;
}> {
  const actions: Action[] = [];
  const width = asset.width ?? 0;
  const height = asset.height ?? 0;
  if (width > MAX_UPLOAD_DIM || height > MAX_UPLOAD_DIM) {
    if (width >= height) {
      actions.push({ resize: { width: MAX_UPLOAD_DIM } });
    } else {
      actions.push({ resize: { height: MAX_UPLOAD_DIM } });
    }
  }

  const result = await manipulateAsync(asset.uri, actions, {
    compress: JPEG_QUALITY,
    format: SaveFormat.JPEG,
  });

  return {
    uri: result.uri,
    fileName: toJpegFileName(asset.fileName),
  };
}

export async function buildPendingChatImage(asset: ImagePickerAsset): Promise<{
  pending: PendingChatImage;
  formData: FormData;
}> {
  const { uri, fileName } = await compressChatImage(asset);

  const formData = new FormData();
  formData.append("file", {
    uri,
    type: "image/jpeg",
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
