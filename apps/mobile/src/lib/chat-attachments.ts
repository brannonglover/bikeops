import type { ImagePickerAsset } from "expo-image-picker";
import {
  manipulateAsync,
  SaveFormat,
  type Action,
} from "expo-image-manipulator";
import {
  uploadAsync,
  FileSystemUploadType,
} from "expo-file-system/legacy";
import { api } from "@/lib/api";

/** Match web chat: stay under Vercel's ~4.5 MB serverless body limit. */
const MAX_UPLOAD_DIM = 2048;
const JPEG_QUALITY = 0.8;
const MAX_VIDEO_UPLOAD_MB = 50;
const MAX_VIDEO_DURATION_SEC = 120;

export type PendingChatMedia = {
  localId: string;
  /** Server attachment id; null while uploading */
  id: string | null;
  previewUri: string;
  url: string | null;
  filename: string;
  mimeType: string;
  kind: "image" | "video";
  status: "uploading" | "ready" | "failed";
};

/** @deprecated Prefer PendingChatMedia */
export type PendingChatImage = PendingChatMedia;

type UploadRoleOpts = { role?: "staff" | "customer" };

function toJpegFileName(fileName: string | null | undefined): string {
  const raw = (fileName?.trim() || "photo").replace(/\.[^.]+$/, "") || "photo";
  return `${raw}.jpg`;
}

function toVideoFileName(
  fileName: string | null | undefined,
  mimeType: string
): string {
  const ext = mimeType === "video/quicktime" ? "mov" : "mp4";
  const raw = (fileName?.trim() || "video").replace(/\.[^.]+$/, "") || "video";
  return `${raw}.${ext}`;
}

function videoMimeType(asset: ImagePickerAsset): string {
  if (asset.mimeType === "video/quicktime" || asset.mimeType === "video/mp4") {
    return asset.mimeType;
  }
  if (/\.mov$/i.test(asset.fileName ?? "") || /\.mov$/i.test(asset.uri)) {
    return "video/quicktime";
  }
  return "video/mp4";
}

/** ImagePicker duration is seconds on Android, milliseconds on iOS. */
function videoDurationSeconds(asset: ImagePickerAsset): number | null {
  if (asset.duration == null) return null;
  return asset.duration > MAX_VIDEO_DURATION_SEC * 10
    ? asset.duration / 1000
    : asset.duration;
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
  pending: PendingChatMedia;
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
      mimeType: "image/jpeg",
      kind: "image",
      status: "uploading",
    },
    formData,
  };
}

export function buildPendingChatVideo(asset: ImagePickerAsset): PendingChatMedia {
  const mimeType = videoMimeType(asset);
  const filename = toVideoFileName(asset.fileName, mimeType);
  const maxBytes = MAX_VIDEO_UPLOAD_MB * 1024 * 1024;

  if (asset.fileSize != null && asset.fileSize > maxBytes) {
    throw new Error(`Video too large. Max size is ${MAX_VIDEO_UPLOAD_MB} MB.`);
  }

  const durationSec = videoDurationSeconds(asset);
  if (durationSec != null && durationSec > MAX_VIDEO_DURATION_SEC) {
    throw new Error(
      `Video is too long. Keep it under ${MAX_VIDEO_DURATION_SEC} seconds.`
    );
  }

  return {
    localId: `local-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    id: null,
    previewUri: asset.uri,
    url: null,
    filename,
    mimeType,
    kind: "video",
    status: "uploading",
  };
}

type VideoTokenResponse = {
  clientToken: string;
  pathname: string;
  access: "public" | "private";
  uploadUrl: string;
  /**
   * Headers the PUT must carry, built by the server.
   *
   * Blob's HTTP API needs more than the bearer token — notably a version header
   * — and getting the set wrong fails the upload with an unrelated-sounding 400.
   * Taking the set from the server means a change there reaches us on a deploy
   * rather than an app release.
   */
  uploadHeaders?: Record<string, string>;
};

type BlobPutResponse = {
  url: string;
  pathname: string;
};

type AttachmentResponse = {
  id: string;
  url: string;
  filename: string;
  mimeType: string;
};

/**
 * Blob reports failures as {"error":{"code","message"}}. Surfacing its message
 * beats guessing at a cause: the last guess here blamed clip length for what
 * was actually a malformed request, which sent debugging the wrong way.
 */
function blobUploadErrorMessage(status: number, body: string): string {
  let detail = "";
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string } };
    detail = parsed.error?.message ?? "";
  } catch {
    detail = "";
  }
  // An over-limit upload comes back as a 403 about file length, against the cap
  // baked into the upload token. The cap is ours, so say it in our own terms —
  // iOS often reports no fileSize for a picked video, so the pre-flight check in
  // buildPendingChatVideo can't catch this and it reaches the server.
  if (/file length/i.test(detail)) {
    return `Video too large. Max size is ${MAX_VIDEO_UPLOAD_MB} MB.`;
  }
  return detail
    ? `Video upload failed (${status}): ${detail}`
    : `Video upload failed (${status}).`;
}

export async function uploadPendingChatVideo(
  asset: ImagePickerAsset,
  pending: PendingChatMedia,
  opts?: UploadRoleOpts
): Promise<AttachmentResponse> {
  const size = asset.fileSize ?? undefined;
  const { data: tokenData } = await api.post<VideoTokenResponse>(
    "/api/chat/upload/token",
    {
      filename: pending.filename,
      mimeType: pending.mimeType,
      size,
    },
    { ...opts, timeoutMs: 30_000 }
  );

  if (!tokenData.uploadHeaders) {
    throw new Error(
      "Video upload is unavailable. Update the app, or try again later."
    );
  }

  const uploadResult = await uploadAsync(tokenData.uploadUrl, asset.uri, {
    httpMethod: "PUT",
    uploadType: FileSystemUploadType.BINARY_CONTENT,
    headers: tokenData.uploadHeaders,
  });

  if (uploadResult.status < 200 || uploadResult.status >= 300) {
    throw new Error(blobUploadErrorMessage(uploadResult.status, uploadResult.body));
  }

  let blob: BlobPutResponse;
  try {
    blob = JSON.parse(uploadResult.body) as BlobPutResponse;
  } catch {
    throw new Error("Video upload returned an unexpected response.");
  }

  if (!blob.url || !blob.pathname) {
    throw new Error("Video upload incomplete.");
  }

  const { data } = await api.post<AttachmentResponse>(
    "/api/chat/upload/complete",
    {
      url: blob.url,
      pathname: blob.pathname,
      filename: pending.filename,
      mimeType: pending.mimeType,
    },
    { ...opts, timeoutMs: 30_000 }
  );

  return data;
}

export function pendingChatImageDisplayUri(image: PendingChatMedia): string {
  return image.previewUri;
}

export function isPendingChatImageReady(image: PendingChatMedia): boolean {
  return image.status === "ready" && !!image.id;
}

export function hasUploadingPendingImages(images: PendingChatMedia[]): boolean {
  return images.some((img) => img.status === "uploading");
}

export function isChatVideoAsset(asset: ImagePickerAsset): boolean {
  return (
    asset.type === "video" ||
    !!asset.mimeType?.startsWith("video/") ||
    /\.(mp4|mov)$/i.test(asset.fileName ?? "") ||
    /\.(mp4|mov)$/i.test(asset.uri)
  );
}
