import { useState, useCallback } from "react";
import { Alert } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { useQueryClient } from "@tanstack/react-query";
import { uploadBikeImage, updateJobBikeImage } from "@/lib/bike-image-upload";
import { syncJobToCaches, updateJobInListCaches } from "@/lib/job-cache-sync";
import type { Job, JobBike } from "@/lib/types";

function applyJobBikeImageUpdate(job: Job, jobBikeId: string, imageUrl: string): Job {
  return {
    ...job,
    jobBikes: (job.jobBikes ?? []).map((jb) =>
      jb.id === jobBikeId ? { ...jb, imageUrl } : jb
    ),
  };
}

export function useJobBikeImageUpload(jobId: string) {
  const queryClient = useQueryClient();
  const [uploadingBikeImageId, setUploadingBikeImageId] = useState<string | null>(null);

  const pickAndUpload = useCallback(
    async (jobBikeId: string, source: "camera" | "library") => {
      if (!jobId || uploadingBikeImageId) return;

      if (source === "camera") {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) {
          Alert.alert(
            "Camera access needed",
            "Allow camera access in Settings to take a bike photo."
          );
          return;
        }
      } else {
        const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!permission.granted) {
          Alert.alert(
            "Photo library access needed",
            "Allow photo library access in Settings to choose a bike photo."
          );
          return;
        }
      }

      const launch =
        source === "camera"
          ? ImagePicker.launchCameraAsync
          : ImagePicker.launchImageLibraryAsync;
      const result = await launch({
        mediaTypes: ["images"],
        quality: 0.8,
        allowsEditing: true,
        aspect: [4, 3],
      });
      if (result.canceled || !result.assets[0]) return;

      setUploadingBikeImageId(jobBikeId);
      const prevJob = queryClient.getQueryData<Job>(["job", jobId]);
      const localPreviewUri = result.assets[0].uri;

      if (prevJob) {
        const optimistic = applyJobBikeImageUpdate(prevJob, jobBikeId, localPreviewUri);
        queryClient.setQueryData(["job", jobId], optimistic);
        updateJobInListCaches(queryClient, optimistic);
      }

      try {
        const imageUrl = await uploadBikeImage(result.assets[0]);
        const updated = await updateJobBikeImage(jobId, jobBikeId, imageUrl);
        syncJobToCaches(queryClient, jobId, updated);
      } catch (e) {
        if (prevJob) {
          queryClient.setQueryData(["job", jobId], prevJob);
          updateJobInListCaches(queryClient, prevJob);
        }
        Alert.alert(
          "Upload failed",
          e instanceof Error ? e.message : "Could not update bike photo"
        );
      } finally {
        setUploadingBikeImageId(null);
      }
    },
    [jobId, uploadingBikeImageId, queryClient]
  );

  const showBikeImageActionSheet = useCallback(
    (jb: JobBike, onViewPhoto?: (url: string) => void) => {
      if (uploadingBikeImageId) return;

      const options: {
        text: string;
        onPress?: () => void;
        style?: "cancel" | "destructive" | "default";
      }[] = [];

      if (jb.imageUrl && onViewPhoto) {
        options.push({
          text: "View Photo",
          onPress: () => onViewPhoto(jb.imageUrl!),
        });
      }

      options.push(
        {
          text: "Take Photo",
          onPress: () => {
            void pickAndUpload(jb.id, "camera");
          },
        },
        {
          text: "Choose from Library",
          onPress: () => {
            void pickAndUpload(jb.id, "library");
          },
        },
        { text: "Cancel", style: "cancel" }
      );

      Alert.alert(jb.imageUrl ? "Bike Photo" : "Add Bike Photo", undefined, options);
    },
    [pickAndUpload, uploadingBikeImageId]
  );

  return {
    uploadingBikeImageId,
    pickAndUpload,
    showBikeImageActionSheet,
  };
}
