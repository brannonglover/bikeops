import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Alert,
  RefreshControl,
  StyleSheet,
  Image,
  Animated,
  Platform,
  Linking,
  Modal,
  Pressable,
  TextInput,
} from "react-native";
import { useLocalSearchParams, useRouter, Stack } from "expo-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/lib/api";
import { type Job, type Stage, type DeliveryType, type BikeType, type Conversation, STAGES, STAGE_LABELS, STAGE_COLORS } from "@/lib/types";
import { colors, spacing, fontSize, borderRadius } from "@/lib/theme";
import { useTheme } from "@/lib/ThemeContext";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { StageBadge, PaymentBadge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { LoadingScreen } from "@/components/ui/LoadingScreen";
import { ImageViewer } from "@/components/ui/ImageViewer";
import { InvoiceTab } from "@/components/jobs/InvoiceTab";
import {
  customerName,
  getJobBikeDisplayTitle,
  formatDate,
  formatCurrency,
  jobTotal,
} from "@/lib/format";
import { AppleMaps } from "expo-maps";
import * as Device from "expo-device";

type Tab = "details" | "invoice";

const MAP_HEIGHT = 150;
const MAP_ZOOM = 15;

function getTileInfo(lat: number, lng: number, zoom: number) {
  const n = Math.pow(2, zoom);
  const xFloat = ((lng + 180) / 360) * n;
  const latRad = (lat * Math.PI) / 180;
  const yFloat =
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) *
    n;
  return {
    tileX: Math.floor(xFloat),
    tileY: Math.floor(yFloat),
    pixelX: Math.round((xFloat - Math.floor(xFloat)) * 256),
    pixelY: Math.round((yFloat - Math.floor(yFloat)) * 256),
  };
}

function PulsingDot({ color }: { color: string }) {
  const opacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 0.3,
          duration: 800,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 1,
          duration: 800,
          useNativeDriver: true,
        }),
      ])
    );
    animation.start();
    return () => animation.stop();
  }, [opacity]);

  return (
    <View style={{ width: 8, height: 8 }}>
      <Animated.View
        style={{
          width: 8,
          height: 8,
          borderRadius: 4,
          backgroundColor: color,
          opacity,
        }}
      />
    </View>
  );
}

export default function JobDetailScreen() {
  const { theme } = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [showStageMenu, setShowStageMenu] = useState(false);
  const [viewingImageUrl, setViewingImageUrl] = useState<string | null>(null);
  const [savingWorkingOn, setSavingWorkingOn] = useState(false);
  const [savingComplete, setSavingComplete] = useState<string | null>(null);
  const [savingWaiting, setSavingWaiting] = useState<string | null>(null);
  const [editAddress, setEditAddress] = useState<string | null>(null);
  const [addressCoords, setAddressCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [mapWidth, setMapWidth] = useState(0);
  const [showActionMenu, setShowActionMenu] = useState(false);
  const actionMenuOpacity = useRef(new Animated.Value(0)).current;
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [cancelReason, setCancelReason] = useState<string | null>(null);
  const [cancelReasonText, setCancelReasonText] = useState("");
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [rejectReasonText, setRejectReasonText] = useState("");
  const [showDatePicker, setShowDatePicker] = useState<"dropOff" | "pickup" | null>(null);
  const [calMonth, setCalMonth] = useState(new Date().getMonth());
  const [calYear, setCalYear] = useState(new Date().getFullYear());
  const [activeTab, setActiveTab] = useState<Tab>("details");
  const [internalNotesValue, setInternalNotesValue] = useState("");
  const [savingInternalNotes, setSavingInternalNotes] = useState(false);
  const [openingChat, setOpeningChat] = useState(false);

  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: {
          flex: 1,
          backgroundColor: theme.background,
        },
        content: {
          padding: spacing[4],
          gap: spacing[3],
          paddingBottom: spacing[12],
        },
        section: {
          gap: spacing[3],
        },
        sectionTitle: {
          ...fontSize.sm,
          fontWeight: "700",
          color: theme.textHeading,
          textTransform: "uppercase",
          letterSpacing: 0.5,
        },
        row: {
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "center",
        },
        label: {
          ...fontSize.sm,
          color: theme.textSecondary,
        },
        value: {
          ...fontSize.sm,
          color: theme.text,
          fontWeight: "500",
          flex: 1,
          textAlign: "right",
          marginLeft: spacing[4],
        },
        stageSelector: {
          flexDirection: "row",
          alignItems: "center",
          gap: spacing[1],
        },
        stageMenu: {
          backgroundColor: theme.background,
          borderRadius: borderRadius.lg,
          padding: spacing[1],
          gap: spacing[0.5],
        },
        stageOption: {
          flexDirection: "row",
          alignItems: "center",
          gap: spacing[2],
          padding: spacing[2],
          borderRadius: borderRadius.md,
        },
        stageOptionActive: {
          backgroundColor: theme.surface,
        },
        stageDot: {
          width: 8,
          height: 8,
          borderRadius: 4,
        },
        stageOptionText: {
          ...fontSize.sm,
          color: theme.textTertiary,
        },
        stageOptionTextActive: {
          fontWeight: "600",
          color: theme.text,
        },
        customerNameText: {
          ...fontSize.base,
          fontWeight: "600",
          color: theme.text,
        },
        meta: {
          ...fontSize.sm,
          color: theme.textSecondary,
        },
        bikeRow: {
          flexDirection: "row",
          gap: spacing[3],
          alignItems: "flex-start",
          borderWidth: 1,
          borderRadius: borderRadius.xl,
          padding: spacing[3],
        },
        bikeRowDefault: {
          borderColor: theme.surfaceBorder,
          backgroundColor: theme.surface,
        },
        bikeRowCompleted: {
          borderColor: theme.dark ? colors.emerald[700] : colors.emerald[300],
          backgroundColor: theme.dark ? colors.emerald[800] + "80" : colors.emerald[50] + "80",
        },
        bikeRowWorkingOn: {
          borderColor: theme.dark ? colors.amber[600] : colors.amber[400],
          backgroundColor: theme.dark ? colors.amber[800] + "99" : colors.amber[50] + "99",
        },
        bikeRowWaiting: {
          borderColor: theme.dark ? colors.red[700] : colors.red[300],
          backgroundColor: theme.dark ? colors.red[800] + "80" : colors.red[50] + "80",
        },
        bikeImage: {
          width: 56,
          height: 56,
          borderRadius: borderRadius.lg,
          backgroundColor: theme.placeholderBg,
        },
        bikePlaceholder: {
          width: 56,
          height: 56,
          borderRadius: borderRadius.lg,
          backgroundColor: theme.placeholderBg,
          justifyContent: "center",
          alignItems: "center",
        },
        bikeInfo: {
          flex: 1,
          gap: 2,
        },
        bikeNameRow: {
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: spacing[1],
        },
        bikeName: {
          ...fontSize.sm,
          fontWeight: "600",
          color: theme.text,
          flex: 1,
        },
        bikeNameCompleted: {
          color: theme.textSecondary,
        },
        doneBadge: {
          flexDirection: "row",
          alignItems: "center",
          gap: 3,
          backgroundColor: theme.dark ? colors.emerald[800] : colors.emerald[200],
          paddingHorizontal: spacing[1.5],
          paddingVertical: 2,
          borderRadius: borderRadius.md,
        },
        doneBadgeText: {
          fontSize: 10,
          fontWeight: "700",
          color: theme.dark ? colors.emerald[300] : colors.emerald[700],
          textTransform: "uppercase",
          letterSpacing: 0.5,
        },
        workingOnBadge: {
          flexDirection: "row",
          alignItems: "center",
          gap: spacing[1],
          backgroundColor: theme.dark ? colors.amber[800] : colors.amber[200],
          paddingHorizontal: spacing[1.5],
          paddingVertical: 2,
          borderRadius: borderRadius.md,
        },
        workingOnBadgeText: {
          fontSize: 10,
          fontWeight: "700",
          color: theme.dark ? colors.amber[300] : colors.amber[700],
          textTransform: "uppercase",
          letterSpacing: 0.5,
        },
        waitingBadge: {
          flexDirection: "row",
          alignItems: "center",
          gap: 3,
          backgroundColor: theme.dark ? colors.red[800] : colors.red[100],
          paddingHorizontal: spacing[1.5],
          paddingVertical: 2,
          borderRadius: borderRadius.md,
        },
        waitingBadgeText: {
          fontSize: 10,
          fontWeight: "700",
          color: theme.dark ? colors.red[300] : colors.red[700],
          textTransform: "uppercase",
          letterSpacing: 0.5,
        },
        bikeNickname: {
          ...fontSize.xs,
          color: theme.textSecondary,
        },
        bikeTypeRow: {
          flexDirection: "row",
          gap: spacing[1],
          marginTop: spacing[1],
        },
        bikeTypeOption: {
          flexDirection: "row",
          alignItems: "center",
          gap: 4,
          paddingHorizontal: spacing[2],
          paddingVertical: 4,
          borderRadius: borderRadius.md,
          backgroundColor: theme.subtleBg,
        },
        bikeTypeOptionActive: {
          backgroundColor: theme.dark ? colors.slate[600] : colors.slate[200],
        },
        bikeTypeOptionEBikeActive: {
          backgroundColor: theme.dark ? colors.blue[600] : colors.blue[100],
        },
        bikeTypeText: {
          ...fontSize.xs,
          color: theme.textMuted,
        },
        bikeTypeTextActive: {
          fontWeight: "600",
          color: theme.dark ? colors.slate[100] : colors.slate[700],
        },
        bikeTypeTextEBikeActive: {
          fontWeight: "600",
          color: theme.dark ? colors.white : colors.blue[600],
        },
        bikeActions: {
          marginTop: spacing[2],
        },
        bikeActionsRow: {
          flexDirection: "row",
          gap: spacing[2],
          flexWrap: "wrap",
        },
        workOnButton: {
          flexDirection: "row",
          alignItems: "center",
          gap: spacing[1],
          paddingHorizontal: spacing[2.5],
          paddingVertical: spacing[1.5],
          borderRadius: borderRadius.lg,
          backgroundColor: theme.subtleBg,
          minHeight: 32,
        },
        workOnText: {
          ...fontSize.xs,
          fontWeight: "600",
          color: theme.textTertiary,
        },
        markDoneButton: {
          flexDirection: "row",
          alignItems: "center",
          gap: spacing[1],
          paddingHorizontal: spacing[2.5],
          paddingVertical: spacing[1.5],
          borderRadius: borderRadius.lg,
          backgroundColor: colors.emerald[600],
          minHeight: 32,
        },
        markDoneText: {
          ...fontSize.xs,
          fontWeight: "600",
          color: colors.white,
        },
        undoDoneButton: {
          flexDirection: "row",
          alignItems: "center",
          gap: spacing[1],
          paddingHorizontal: spacing[2.5],
          paddingVertical: spacing[1.5],
          borderRadius: borderRadius.lg,
          backgroundColor: theme.dark ? colors.emerald[800] : colors.emerald[100],
          minHeight: 32,
        },
        undoDoneText: {
          ...fontSize.xs,
          fontWeight: "600",
          color: theme.dark ? colors.emerald[300] : colors.emerald[700],
        },
        waitForPartsButton: {
          flexDirection: "row",
          alignItems: "center",
          gap: spacing[1],
          paddingHorizontal: spacing[2.5],
          paddingVertical: spacing[1.5],
          borderRadius: borderRadius.lg,
          backgroundColor: theme.dark ? colors.red[800] : colors.red[100],
          minHeight: 32,
        },
        waitForPartsText: {
          ...fontSize.xs,
          fontWeight: "600",
          color: theme.dark ? colors.red[300] : colors.red[700],
        },
        resumeWorkButton: {
          flexDirection: "row",
          alignItems: "center",
          gap: spacing[1],
          paddingHorizontal: spacing[2.5],
          paddingVertical: spacing[1.5],
          borderRadius: borderRadius.lg,
          backgroundColor: theme.dark ? colors.amber[800] : colors.amber[100],
          minHeight: 32,
        },
        resumeWorkText: {
          ...fontSize.xs,
          fontWeight: "600",
          color: theme.dark ? colors.amber[300] : colors.amber[800],
        },
        buttonDisabled: {
          opacity: 0.5,
        },
        lineItem: {
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "center",
          paddingVertical: spacing[1],
        },
        lineItemLeft: {
          flexDirection: "row",
          alignItems: "center",
          gap: spacing[2],
          flex: 1,
        },
        lineItemName: {
          ...fontSize.sm,
          color: theme.text,
          flex: 1,
        },
        lineItemQty: {
          ...fontSize.xs,
          color: theme.textSecondary,
        },
        lineItemPrice: {
          ...fontSize.sm,
          fontWeight: "600",
          color: theme.text,
          fontVariant: ["tabular-nums"],
        },
        totalRow: {
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "center",
        },
        totalLabel: {
          ...fontSize.base,
          fontWeight: "700",
          color: theme.text,
        },
        totalAmount: {
          ...fontSize.xl,
          fontWeight: "700",
          color: theme.text,
          fontVariant: ["tabular-nums"],
        },
        noteBlock: {
          gap: spacing[1],
        },
        noteLabel: {
          ...fontSize.xs,
          fontWeight: "600",
          color: theme.textSecondary,
          textTransform: "uppercase",
        },
        noteText: {
          ...fontSize.sm,
          color: theme.textTertiary,
          lineHeight: 20,
        },
        deliveryOptions: {
          gap: spacing[1],
        },
        deliveryOption: {
          flexDirection: "row",
          alignItems: "center",
          gap: spacing[3],
          paddingHorizontal: spacing[3],
          minHeight: 44,
          borderRadius: borderRadius.lg,
        },
        deliveryOptionActive: {
          backgroundColor: theme.dark ? `${colors.amber[500]}22` : colors.amber[50],
        },
        deliveryLabel: {
          ...fontSize.sm,
          color: theme.text,
        },
        addressSection: {
          gap: spacing[2],
        },
        addressDisplay: {
          flexDirection: "row",
          alignItems: "center",
          gap: spacing[2],
          padding: spacing[3],
          borderRadius: borderRadius.lg,
          backgroundColor: theme.subtleBg,
          minHeight: 44,
        },
        addressDisplayContent: {
          flex: 1,
        },
        addressDisplayText: {
          ...fontSize.sm,
          fontWeight: "500",
          color: theme.text,
        },
        addressHint: {
          ...fontSize.xs,
          color: theme.textMuted,
          marginTop: 2,
        },
        mapContainer: {
          height: MAP_HEIGHT,
          borderRadius: borderRadius.lg,
          overflow: "hidden",
          backgroundColor: theme.placeholderBg,
        },
        appleMap: {
          flex: 1,
        },
        mapPin: {
          position: "absolute",
          zIndex: 1,
        },
        mapAttribution: {
          position: "absolute",
          bottom: spacing[1],
          right: spacing[1],
          ...fontSize.xs,
          color: colors.slate[600],
          backgroundColor: "rgba(255,255,255,0.7)",
          paddingHorizontal: spacing[1],
          borderRadius: borderRadius.sm,
          fontSize: 9,
        },
        addressSuggestion: {
          flexDirection: "row",
          alignItems: "center",
          gap: spacing[2],
          padding: spacing[3],
          borderRadius: borderRadius.lg,
          backgroundColor: colors.amber[50],
          borderWidth: 1,
          borderColor: colors.amber[200],
          minHeight: 44,
        },
        addressSuggestionContent: {
          flex: 1,
        },
        addressSuggestionLabel: {
          ...fontSize.xs,
          fontWeight: "600",
          color: colors.amber[700],
        },
        addressSuggestionText: {
          ...fontSize.sm,
          color: theme.text,
        },
        addressTappable: {
          flexDirection: "row",
          alignItems: "center",
          gap: spacing[2],
          padding: spacing[3],
          borderRadius: borderRadius.lg,
          borderWidth: 1,
          borderColor: theme.inputBorder,
          backgroundColor: theme.inputBg,
          minHeight: 44,
        },
        addressTappableText: {
          ...fontSize.sm,
          color: theme.text,
          flex: 1,
        },
        dateValue: {
          flexDirection: "row" as const,
          alignItems: "center" as const,
          gap: spacing[1.5],
        },
        dateText: {
          ...fontSize.sm,
          color: theme.text,
          fontWeight: "500" as const,
        },
        actionsSection: {
          gap: spacing[3],
          marginTop: spacing[2],
        },
        tabBar: {
          flexDirection: "row",
          borderBottomWidth: 1,
          borderBottomColor: theme.surfaceBorder,
          backgroundColor: theme.background,
        },
        tab: {
          flex: 1,
          paddingVertical: spacing[3],
          alignItems: "center",
        },
        tabText: {
          ...fontSize.sm,
          fontWeight: "500",
          color: theme.textSecondary,
        },
        tabActive: {
          borderBottomWidth: 2,
          borderBottomColor: colors.blue[500],
        },
        tabTextActive: {
          color: colors.blue[500],
          fontWeight: "600",
        },
        invoiceContainer: {
          padding: spacing[4],
          paddingBottom: spacing[12],
        },
      }),
    [theme]
  );

  const {
    data: job,
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ["job", id],
    queryFn: async () => {
      const { data } = await api.get<Job>(`/api/jobs/${id}`);
      return data;
    },
    enabled: !!id,
  });

  const [isManualRefresh, setIsManualRefresh] = useState(false);
  const handleRefresh = useCallback(async () => {
    setIsManualRefresh(true);
    try {
      await refetch();
    } finally {
      setIsManualRefresh(false);
    }
  }, [refetch]);

  const patchJob = useMutation({
    mutationFn: async (body: Partial<Job>) => {
      const { data } = await api.patch<Job>(`/api/jobs/${id}`, body);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["job", id] });
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
    },
  });

  useEffect(() => {
    setInternalNotesValue(job?.internalNotes ?? "");
  }, [job?.id]);

  const handleSaveInternalNotes = useCallback(async () => {
    if (!job) return;
    const trimmed = internalNotesValue.trim();
    const current = (job.internalNotes ?? "").trim();
    if (trimmed === current) return;
    setSavingInternalNotes(true);
    try {
      await api.patch(`/api/jobs/${job.id}`, { internalNotes: trimmed || null });
      queryClient.invalidateQueries({ queryKey: ["job", id] });
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
    } finally {
      setSavingInternalNotes(false);
    }
  }, [job, internalNotesValue, id, queryClient]);

  const deleteJob = useMutation({
    mutationFn: async () => {
      await api.delete(`/api/jobs/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      router.back();
    },
  });

  const handleStageChange = useCallback(
    (stage: Stage) => {
      if (!job) return;
      const patch: Record<string, unknown> = { stage };

      if (stage === "WORKING_ON") {
        // When the stage is manually set to WORKING_ON, also clear the per-bike
        // "waiting on parts" state so the badge doesn't linger. Mirror what
        // handleResumeWork does: pick the first waiting (non-completed) bike.
        const waitingBike = job.jobBikes.find(
          (jb) => !!jb.waitingOnPartsAt && !jb.completedAt
        );
        if (waitingBike) {
          patch.unwaitForPartsJobBikeId = waitingBike.id;
          patch.workingOnJobBikeId = waitingBike.id;
        } else if (!job.workingOnJobBikeId) {
          const firstActive = job.jobBikes.find((jb) => !jb.completedAt);
          if (firstActive) patch.workingOnJobBikeId = firstActive.id;
        }
      } else if (stage === "WAITING_ON_PARTS") {
        // Mirror what handleWaitForParts does: pick the currently active bike
        // (or the first non-completed one) so the per-bike badge updates too.
        const targetBike =
          job.jobBikes.find((jb) => jb.id === job.workingOnJobBikeId) ??
          job.jobBikes.find((jb) => !jb.completedAt);
        if (targetBike) patch.waitForPartsJobBikeId = targetBike.id;
      }

      patchJob.mutate(patch as unknown as Partial<Job>);
      setShowStageMenu(false);
    },
    [job, patchJob]
  );

  const handleDelete = useCallback(() => {
    setShowActionMenu(false);
    Alert.alert("Delete Job", "This action cannot be undone.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => deleteJob.mutate(),
      },
    ]);
  }, [deleteJob]);

  const openActionMenu = useCallback(() => {
    setShowActionMenu(true);
    Animated.timing(actionMenuOpacity, {
      toValue: 1,
      duration: 150,
      useNativeDriver: true,
    }).start();
  }, [actionMenuOpacity]);

  const closeActionMenu = useCallback(() => {
    Animated.timing(actionMenuOpacity, {
      toValue: 0,
      duration: 120,
      useNativeDriver: true,
    }).start(() => setShowActionMenu(false));
  }, [actionMenuOpacity]);

  const CANCEL_REASONS = [
    "Customer requested cancellation",
    "Parts unavailable",
    "Unable to complete repair",
    "Customer no-show",
    "Duplicate job",
  ];

  const openCancelModal = useCallback(() => {
    setShowActionMenu(false);
    setCancelReason(null);
    setCancelReasonText("");
    setShowCancelModal(true);
  }, []);

  const handleCancelJob = useCallback(() => {
    const reason =
      cancelReason === "Other"
        ? cancelReasonText.trim() || "Other"
        : cancelReason ?? undefined;
    patchJob.mutate(
      { stage: "CANCELLED", cancellationReason: reason } as Partial<Job>,
      {
        onSuccess: () => {
          setShowCancelModal(false);
        },
      }
    );
  }, [cancelReason, cancelReasonText, patchJob]);

  const handleAcceptBooking = useCallback(() => {
    patchJob.mutate({ stage: "BOOKED_IN" } as Partial<Job>);
  }, [patchJob]);

  const openRejectModal = useCallback(() => {
    setRejectReasonText("");
    setShowRejectModal(true);
  }, []);

  const handleRejectBooking = useCallback(() => {
    const reason = rejectReasonText.trim();
    if (!reason) return;
    patchJob.mutate(
      { stage: "CANCELLED", cancellationReason: reason } as Partial<Job>,
      {
        onSuccess: () => {
          setShowRejectModal(false);
        },
      }
    );
  }, [rejectReasonText, patchJob]);

  const handleToggleWorkingOn = useCallback(
    (bikeId: string) => {
      if (savingWorkingOn || !job) return;
      const nextId = job.workingOnJobBikeId === bikeId ? null : bikeId;
      setSavingWorkingOn(true);
      const patch: Record<string, unknown> = { workingOnJobBikeId: nextId };
      if (nextId && job.stage !== "WORKING_ON") {
        patch.stage = "WORKING_ON";
        patch.notifyCustomer = false;
      }
      // Always clear the waiting state for the clicked bike if it was waiting —
      // this matters when the job is already WORKING_ON (e.g. switching to a
      // different bike that still has waitingOnPartsAt set from a prior state).
      if (nextId) {
        const clickedBike = job.jobBikes.find((jb) => jb.id === nextId);
        if (clickedBike?.waitingOnPartsAt && !clickedBike.completedAt) {
          patch.unwaitForPartsJobBikeId = nextId;
        }
      }
      patchJob.mutate(
        patch as Partial<Job>,
        { onSettled: () => setSavingWorkingOn(false) }
      );
    },
    [job, savingWorkingOn, patchJob]
  );

  const handleToggleComplete = useCallback(
    (bikeId: string, isCompleted: boolean) => {
      if (savingComplete) return;
      setSavingComplete(bikeId);
      const body = isCompleted
        ? { uncompleteJobBikeId: bikeId }
        : { completeJobBikeId: bikeId };
      patchJob.mutate(body as unknown as Partial<Job>, {
        onSettled: () => setSavingComplete(null),
      });
    },
    [savingComplete, patchJob]
  );

  const handleWaitForParts = useCallback(
    (bikeId: string) => {
      if (savingWaiting) return;
      setSavingWaiting(bikeId);
      patchJob.mutate(
        { waitForPartsJobBikeId: bikeId } as unknown as Partial<Job>,
        { onSettled: () => setSavingWaiting(null) }
      );
    },
    [savingWaiting, patchJob]
  );

  const handleDeliveryTypeChange = useCallback(
    (newType: DeliveryType) => {
      if (!job || job.deliveryType === newType) return;
      const patch: Record<string, unknown> = { deliveryType: newType };
      if (newType === "DROP_OFF_AT_SHOP") {
        patch.collectionAddress = null;
        setEditAddress(null);
      }
      patchJob.mutate(patch as Partial<Job>);
    },
    [job, patchJob]
  );

  const handleSaveAddress = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!job) return;
      if (trimmed === (job.collectionAddress ?? "")) {
        setEditAddress(null);
        return;
      }
      patchJob.mutate({ collectionAddress: trimmed || null } as Partial<Job>);
      setEditAddress(null);
    },
    [job, patchJob]
  );

  const handleBikeTypeChange = useCallback(
    (jobBikeId: string, bikeType: BikeType) => {
      if (!job) return;
      const bikes = job.jobBikes.map((jb) => ({
        make: jb.make,
        model: jb.model,
        nickname: jb.nickname,
        imageUrl: jb.imageUrl,
        bikeId: jb.bikeId,
        bikeType: jb.id === jobBikeId ? bikeType : jb.bikeType,
      }));
      patchJob.mutate({ bikes } as unknown as Partial<Job>);
    },
    [job, patchJob]
  );

  const handleResumeWork = useCallback(
    (bikeId: string) => {
      if (savingWaiting) return;
      setSavingWaiting(bikeId);
      patchJob.mutate(
        {
          stage: "WORKING_ON",
          unwaitForPartsJobBikeId: bikeId,
          workingOnJobBikeId: bikeId,
        } as unknown as Partial<Job>,
        { onSettled: () => setSavingWaiting(null) }
      );
    },
    [savingWaiting, patchJob]
  );

  const openDatePicker = useCallback(
    (field: "dropOff" | "pickup") => {
      if (!job) return;
      const existing = field === "dropOff" ? job.dropOffDate : job.pickupDate;
      const d = existing ? new Date(existing) : new Date();
      setCalMonth(d.getMonth());
      setCalYear(d.getFullYear());
      setShowDatePicker(field);
    },
    [job]
  );

  const handleSelectDay = useCallback(
    (day: number) => {
      if (!showDatePicker) return;
      const iso = new Date(calYear, calMonth, day, 12).toISOString();
      const patch =
        showDatePicker === "dropOff"
          ? { dropOffDate: iso }
          : { pickupDate: iso };
      patchJob.mutate(patch as Partial<Job>);
      setShowDatePicker(null);
    },
    [showDatePicker, calYear, calMonth, patchJob]
  );

  const clearDate = useCallback(
    (field: "dropOff" | "pickup") => {
      const patch =
        field === "dropOff"
          ? { dropOffDate: null }
          : { pickupDate: null };
      patchJob.mutate(patch as Partial<Job>);
      setShowDatePicker(null);
    },
    [patchJob]
  );

  const calDays = useMemo(() => {
    const firstDay = new Date(calYear, calMonth, 1).getDay();
    const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
    const blanks: null[] = Array(firstDay).fill(null);
    const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);
    return [...blanks, ...days];
  }, [calYear, calMonth]);

  const calSelectedDay = useMemo(() => {
    if (!showDatePicker || !job) return null;
    const raw = showDatePicker === "dropOff" ? job.dropOffDate : job.pickupDate;
    if (!raw) return null;
    const d = new Date(raw);
    if (d.getMonth() === calMonth && d.getFullYear() === calYear) return d.getDate();
    return null;
  }, [showDatePicker, job, calMonth, calYear]);

  useEffect(() => {
    if (!job?.collectionAddress || job.deliveryType !== "COLLECTION_SERVICE") {
      setAddressCoords(null);
      return;
    }
    let cancelled = false;
    fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(job.collectionAddress)}&format=json&limit=1`,
      { headers: { Accept: "application/json" } }
    )
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled && data?.length > 0) {
          setAddressCoords({
            lat: parseFloat(data[0].lat),
            lng: parseFloat(data[0].lon),
          });
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [job?.collectionAddress, job?.deliveryType]);

  const openDirections = useCallback(() => {
    if (!job?.collectionAddress) return;
    const addr = encodeURIComponent(job.collectionAddress);
    if (Platform.OS === "ios") {
      Linking.openURL(`maps:?daddr=${addr}`);
    } else if (Platform.OS === "android") {
      Linking.openURL(`google.navigation:q=${addr}`);
    } else {
      Linking.openURL(
        `https://www.google.com/maps/dir/?api=1&destination=${addr}`
      );
    }
  }, [job?.collectionAddress]);

  const mapTiles = useMemo(() => {
    if (!addressCoords || mapWidth <= 0) return null;
    const info = getTileInfo(addressCoords.lat, addressCoords.lng, MAP_ZOOM);
    const cx = mapWidth / 2;
    const cy = MAP_HEIGHT / 2;
    const tiles: { key: string; uri: string; left: number; top: number }[] = [];
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        tiles.push({
          key: `${dx}-${dy}`,
          uri: `https://a.tile.openstreetmap.org/${MAP_ZOOM}/${info.tileX + dx}/${info.tileY + dy}.png`,
          left: cx - info.pixelX + dx * 256,
          top: cy - info.pixelY + dy * 256,
        });
      }
    }
    return { tiles, pinLeft: cx - 14, pinTop: cy - 28 };
  }, [addressCoords, mapWidth]);

  const handleInvoiceJobUpdated = useCallback(
    (updated: Job) => {
      queryClient.setQueryData(["job", id], updated);
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
    },
    [queryClient, id]
  );

  const handleOpenChat = useCallback(async () => {
    if (!job?.customer || openingChat) return;
    setOpeningChat(true);
    try {
      const cached = queryClient.getQueryData<Conversation[]>(["conversations"]);
      const findConv = (list: Conversation[]) =>
        list.find((c) => c.customerId === job.customer!.id && c.jobId === job.id) ??
        list.find((c) => c.customerId === job.customer!.id && !c.jobId) ??
        list.find((c) => c.customerId === job.customer!.id);

      const fromCache = cached ? findConv(cached) : undefined;
      if (fromCache) {
        router.push(`/(staff)/chat/${fromCache.id}` as never);
        return;
      }

      const { data: convs } = await api.get<Conversation[]>("/api/conversations");
      queryClient.setQueryData(["conversations"], convs);
      const existing = findConv(convs);
      if (existing) {
        router.push(`/(staff)/chat/${existing.id}` as never);
        return;
      }

      const { data: newConv } = await api.post<Conversation>("/api/conversations", {
        customerId: job.customer!.id,
      });
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
      router.push(`/(staff)/chat/${newConv.id}` as never);
    } catch {
      Alert.alert("Error", "Failed to open chat");
    } finally {
      setOpeningChat(false);
    }
  }, [job, openingChat, queryClient, router]);

  if (isLoading || !job) return <LoadingScreen message="Loading job..." />;

  const total = jobTotal(job.jobServices, job.jobProducts);

  return (
    <>
      <Stack.Screen
        options={{
          title: getJobBikeDisplayTitle(job),
          headerRight: () => (
            <TouchableOpacity onPress={openActionMenu} style={{ padding: spacing[2] }}>
              <Ionicons name="ellipsis-vertical" size={20} color={theme.text} />
            </TouchableOpacity>
          ),
        }}
      />
      {/* Tab bar */}
      <View style={styles.tabBar}>
        <TouchableOpacity
          style={[styles.tab, activeTab === "details" && styles.tabActive]}
          onPress={() => setActiveTab("details")}
          activeOpacity={0.7}
        >
          <Text style={[styles.tabText, activeTab === "details" && styles.tabTextActive]}>
            Details
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === "invoice" && styles.tabActive]}
          onPress={() => setActiveTab("invoice")}
          activeOpacity={0.7}
        >
          <Text style={[styles.tabText, activeTab === "invoice" && styles.tabTextActive]}>
            Invoice
          </Text>
        </TouchableOpacity>
      </View>
      <ScrollView
        style={styles.container}
        contentContainerStyle={activeTab === "invoice" ? styles.invoiceContainer : styles.content}
        refreshControl={
          <RefreshControl refreshing={isManualRefresh} onRefresh={handleRefresh} />
        }
      >
        {activeTab === "invoice" ? (
          <InvoiceTab job={job} onJobUpdated={handleInvoiceJobUpdated} />
        ) : (
        <>
        {/* Booking Request Banner */}
        {job.stage === "PENDING_APPROVAL" ? (
          <Card
            style={[
              styles.section,
              {
                borderWidth: 1,
                borderColor: theme.dark ? colors.amber[700] : colors.amber[300],
                backgroundColor: theme.dark ? `${colors.amber[900]}66` : colors.amber[50],
              },
            ]}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: spacing[2] }}>
              <Ionicons name="time-outline" size={18} color={theme.dark ? colors.amber[400] : colors.amber[600]} />
              <Text style={{ ...fontSize.base, fontWeight: "700", color: theme.dark ? colors.amber[300] : colors.amber[800] }}>
                New Booking Request
              </Text>
            </View>
            <Text style={{ ...fontSize.sm, color: theme.dark ? colors.amber[400] : colors.amber[700], lineHeight: 20 }}>
              Review this request and accept or reject it. The customer will be notified by email and SMS.
            </Text>
            <View style={{ flexDirection: "row", gap: spacing[2], marginTop: spacing[1] }}>
              <TouchableOpacity
                onPress={handleAcceptBooking}
                disabled={patchJob.isPending}
                style={[
                  {
                    flex: 1,
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: spacing[1.5],
                    paddingVertical: spacing[3],
                    borderRadius: borderRadius.xl,
                    backgroundColor: colors.emerald[600],
                  },
                  patchJob.isPending && styles.buttonDisabled,
                ]}
              >
                <Ionicons name="checkmark" size={16} color={colors.white} />
                <Text style={{ ...fontSize.sm, fontWeight: "700", color: colors.white }}>
                  Accept
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={openRejectModal}
                disabled={patchJob.isPending}
                style={[
                  {
                    flex: 1,
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: spacing[1.5],
                    paddingVertical: spacing[3],
                    borderRadius: borderRadius.xl,
                    backgroundColor: theme.dark ? colors.red[900] : colors.red[50],
                    borderWidth: 1,
                    borderColor: theme.dark ? colors.red[700] : colors.red[300],
                  },
                  patchJob.isPending && styles.buttonDisabled,
                ]}
              >
                <Ionicons name="close" size={16} color={theme.dark ? colors.red[400] : colors.red[600]} />
                <Text style={{ ...fontSize.sm, fontWeight: "700", color: theme.dark ? colors.red[400] : colors.red[600] }}>
                  Reject
                </Text>
              </TouchableOpacity>
            </View>
          </Card>
        ) : null}

        {/* Stage and Status */}
        <Card style={styles.section}>
          <View style={styles.row}>
            <Text style={styles.label}>Status</Text>
            <TouchableOpacity
              onPress={() => setShowStageMenu(!showStageMenu)}
              style={styles.stageSelector}
            >
              <StageBadge stage={job.stage} />
              <Ionicons name="chevron-down" size={14} color={theme.textMuted} />
            </TouchableOpacity>
          </View>
          {showStageMenu ? (
            <View style={styles.stageMenu}>
              {STAGES.map((stage) => (
                <TouchableOpacity
                  key={stage}
                  onPress={() => handleStageChange(stage)}
                  style={[
                    styles.stageOption,
                    job.stage === stage && styles.stageOptionActive,
                  ]}
                >
                  <View
                    style={[
                      styles.stageDot,
                      { backgroundColor: STAGE_COLORS[stage] },
                    ]}
                  />
                  <Text
                    style={[
                      styles.stageOptionText,
                      job.stage === stage && styles.stageOptionTextActive,
                    ]}
                  >
                    {STAGE_LABELS[stage]}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          ) : null}
          <View style={styles.row}>
            <Text style={styles.label}>Payment</Text>
            <PaymentBadge status={job.paymentStatus} />
          </View>
          {job.cancellationReason ? (
            <View style={styles.row}>
              <Text style={styles.label}>Cancellation Reason</Text>
              <Text style={styles.value}>{job.cancellationReason}</Text>
            </View>
          ) : null}
        </Card>

        {/* Customer */}
        {job.customer ? (
          <Card style={styles.section}>
            <Text style={styles.sectionTitle}>Customer</Text>
            <Text style={styles.customerNameText}>
              {customerName(job.customer)}
            </Text>
            {job.customer.email ? (
              <TouchableOpacity
                onPress={() => Linking.openURL(`mailto:${job.customer!.email}`)}
                activeOpacity={0.6}
              >
                <Text style={[styles.meta, { color: colors.blue[500] }]}>
                  {job.customer.email}
                </Text>
              </TouchableOpacity>
            ) : null}
            {job.customer.phone ? (
              <TouchableOpacity
                onPress={() => Linking.openURL(`tel:${job.customer!.phone}`)}
                activeOpacity={0.6}
              >
                <Text style={[styles.meta, { color: colors.blue[500] }]}>
                  {job.customer.phone}
                </Text>
              </TouchableOpacity>
            ) : null}
          </Card>
        ) : null}

        {/* Bikes */}
        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>
            {job.jobBikes.length === 1 ? "Bike" : `Bikes (${job.jobBikes.length})`}
          </Text>
          {job.jobBikes.map((jb) => {
            const isWorkingOn = job.workingOnJobBikeId === jb.id;
            const isCompleted = !!jb.completedAt;
            // Never show "waiting on parts" for the bike currently being worked on —
            // waitingOnPartsAt may still be set from a previous state.
            const isWaitingOnParts = !!jb.waitingOnPartsAt && !isCompleted && !isWorkingOn;

            return (
              <View
                key={jb.id}
                style={[
                  styles.bikeRow,
                  isCompleted
                    ? styles.bikeRowCompleted
                    : isWaitingOnParts
                      ? styles.bikeRowWaiting
                      : isWorkingOn
                        ? styles.bikeRowWorkingOn
                        : styles.bikeRowDefault,
                ]}
              >
                {jb.imageUrl ? (
                  <TouchableOpacity
                    activeOpacity={0.8}
                    onPress={() => setViewingImageUrl(jb.imageUrl!)}
                  >
                    <Image source={{ uri: jb.imageUrl }} style={styles.bikeImage} />
                  </TouchableOpacity>
                ) : (
                  <View style={styles.bikePlaceholder}>
                    <Ionicons name="bicycle" size={24} color={theme.iconMuted} />
                  </View>
                )}
                <View style={styles.bikeInfo}>
                  <View style={styles.bikeNameRow}>
                    <Text
                      style={[
                        styles.bikeName,
                        (isCompleted || isWaitingOnParts) && styles.bikeNameCompleted,
                      ]}
                      numberOfLines={1}
                    >
                      {jb.make} {jb.model}
                    </Text>
                    {isCompleted ? (
                      <View style={styles.doneBadge}>
                        <Ionicons name="checkmark" size={10} color={colors.emerald[700]} />
                        <Text style={styles.doneBadgeText}>Done</Text>
                      </View>
                    ) : isWaitingOnParts ? (
                      <View style={styles.waitingBadge}>
                        <Ionicons name="time" size={10} color={colors.red[700]} />
                        <Text style={styles.waitingBadgeText}>Waiting on parts</Text>
                      </View>
                    ) : isWorkingOn ? (
                      <View style={styles.workingOnBadge}>
                        <PulsingDot color={colors.amber[600]} />
                        <Text style={styles.workingOnBadgeText}>Working on</Text>
                      </View>
                    ) : null}
                  </View>
                  {jb.nickname ? (
                    <Text style={styles.bikeNickname}>{jb.nickname}</Text>
                  ) : null}
                  <View style={styles.bikeTypeRow}>
                    <TouchableOpacity
                      onPress={() => handleBikeTypeChange(jb.id, "REGULAR")}
                      style={[
                        styles.bikeTypeOption,
                        jb.bikeType !== "E_BIKE" && styles.bikeTypeOptionActive,
                      ]}
                    >
                      <Ionicons
                        name="bicycle"
                        size={12}
                        color={jb.bikeType !== "E_BIKE" ? colors.slate[700] : theme.textMuted}
                      />
                      <Text
                        style={[
                          styles.bikeTypeText,
                          jb.bikeType !== "E_BIKE" && styles.bikeTypeTextActive,
                        ]}
                      >
                        Regular
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => handleBikeTypeChange(jb.id, "E_BIKE")}
                      style={[
                        styles.bikeTypeOption,
                        jb.bikeType === "E_BIKE" && styles.bikeTypeOptionEBikeActive,
                      ]}
                    >
                      <Ionicons
                        name="flash"
                        size={12}
                        color={jb.bikeType === "E_BIKE" ? colors.blue[700] : theme.textMuted}
                      />
                      <Text
                        style={[
                          styles.bikeTypeText,
                          jb.bikeType === "E_BIKE" && styles.bikeTypeTextEBikeActive,
                        ]}
                      >
                        E-Bike
                      </Text>
                    </TouchableOpacity>
                  </View>

                  <View style={styles.bikeActions}>
                    {isCompleted ? (
                      <TouchableOpacity
                        onPress={() => handleToggleComplete(jb.id, true)}
                        disabled={!!savingComplete}
                        style={[styles.undoDoneButton, !!savingComplete && styles.buttonDisabled]}
                      >
                        <Ionicons name="arrow-undo" size={13} color={colors.emerald[700]} />
                        <Text style={styles.undoDoneText}>Undo done</Text>
                      </TouchableOpacity>
                    ) : isWaitingOnParts ? (
                      <TouchableOpacity
                        onPress={() => handleResumeWork(jb.id)}
                        disabled={!!savingWaiting}
                        style={[styles.resumeWorkButton, !!savingWaiting && styles.buttonDisabled]}
                      >
                        <Ionicons name="build" size={13} color={colors.amber[800]} />
                        <Text style={styles.resumeWorkText}>Resume work</Text>
                      </TouchableOpacity>
                    ) : isWorkingOn ? (
                      <View style={styles.bikeActionsRow}>
                        <TouchableOpacity
                          onPress={() => handleToggleComplete(jb.id, false)}
                          disabled={!!savingComplete}
                          style={[styles.markDoneButton, !!savingComplete && styles.buttonDisabled]}
                        >
                          <Ionicons name="checkmark" size={13} color={colors.white} />
                          <Text style={styles.markDoneText}>Mark done</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={() => handleWaitForParts(jb.id)}
                          disabled={!!savingWaiting}
                          style={[styles.waitForPartsButton, !!savingWaiting && styles.buttonDisabled]}
                        >
                          <Ionicons name="time" size={13} color={colors.red[700]} />
                          <Text style={styles.waitForPartsText}>Waiting on parts</Text>
                        </TouchableOpacity>
                      </View>
                    ) : (
                      <TouchableOpacity
                        onPress={() => handleToggleWorkingOn(jb.id)}
                        disabled={savingWorkingOn}
                        style={[styles.workOnButton, savingWorkingOn && styles.buttonDisabled]}
                      >
                        <Ionicons name="build" size={13} color={theme.textTertiary} />
                        <Text style={styles.workOnText}>Work on this</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              </View>
            );
          })}
        </Card>

        {/* Dates & Delivery */}
        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>Details</Text>
          <Text style={styles.label}>Delivery</Text>
          <View style={styles.deliveryOptions}>
            <TouchableOpacity
              onPress={() => handleDeliveryTypeChange("DROP_OFF_AT_SHOP")}
              style={[
                styles.deliveryOption,
                job.deliveryType === "DROP_OFF_AT_SHOP" && styles.deliveryOptionActive,
              ]}
            >
              <Ionicons
                name={
                  job.deliveryType === "DROP_OFF_AT_SHOP"
                    ? "radio-button-on"
                    : "radio-button-off"
                }
                size={20}
                color={
                  job.deliveryType === "DROP_OFF_AT_SHOP"
                    ? colors.amber[500]
                    : theme.textMuted
                }
              />
              <Text style={styles.deliveryLabel}>Drop-off at shop</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => handleDeliveryTypeChange("COLLECTION_SERVICE")}
              style={[
                styles.deliveryOption,
                job.deliveryType === "COLLECTION_SERVICE" && styles.deliveryOptionActive,
              ]}
            >
              <Ionicons
                name={
                  job.deliveryType === "COLLECTION_SERVICE"
                    ? "radio-button-on"
                    : "radio-button-off"
                }
                size={20}
                color={
                  job.deliveryType === "COLLECTION_SERVICE"
                    ? colors.amber[500]
                    : theme.textMuted
                }
              />
              <Text style={styles.deliveryLabel}>Collection service</Text>
            </TouchableOpacity>
          </View>
          {job.deliveryType === "COLLECTION_SERVICE" ? (
            <View style={styles.addressSection}>
              <Text style={styles.label}>Collection Address</Text>

              {/* Address is set and not editing */}
              {job.collectionAddress && editAddress === null ? (
                <>
                  <TouchableOpacity
                    onPress={openDirections}
                    onLongPress={() =>
                      setEditAddress(job.collectionAddress ?? "")
                    }
                    activeOpacity={0.7}
                    style={styles.addressDisplay}
                  >
                    <Ionicons
                      name="location-sharp"
                      size={18}
                      color={colors.amber[500]}
                    />
                    <View style={styles.addressDisplayContent}>
                      <Text style={styles.addressDisplayText}>
                        {job.collectionAddress}
                      </Text>
                      <Text style={styles.addressHint}>
                        Tap for directions · Hold to edit
                      </Text>
                    </View>
                    <Ionicons
                      name="navigate-outline"
                      size={20}
                      color={colors.amber[500]}
                    />
                  </TouchableOpacity>

                  {addressCoords ? (
                    Platform.OS === "ios" &&
                    parseInt(String(Platform.Version), 10) >= 17 &&
                    Device.isDevice ? (
                      <View style={styles.mapContainer}>
                        <AppleMaps.View
                          style={styles.appleMap}
                          cameraPosition={{
                            coordinates: {
                              latitude: addressCoords.lat,
                              longitude: addressCoords.lng,
                            },
                            zoom: 15,
                          }}
                          uiSettings={{
                            compassEnabled: false,
                            myLocationButtonEnabled: false,
                            scaleBarEnabled: false,
                            togglePitchEnabled: false,
                          }}
                          markers={[
                            {
                              coordinates: {
                                latitude: addressCoords.lat,
                                longitude: addressCoords.lng,
                              },
                            },
                          ]}
                          onMapClick={openDirections}
                          onMarkerClick={openDirections}
                        />
                      </View>
                    ) : (
                      <TouchableOpacity
                        onPress={openDirections}
                        activeOpacity={0.9}
                        style={styles.mapContainer}
                        onLayout={(e) =>
                          setMapWidth(e.nativeEvent.layout.width)
                        }
                      >
                        {mapTiles
                          ? mapTiles.tiles.map((t) => (
                              <Image
                                key={t.key}
                                source={{ uri: t.uri }}
                                style={{
                                  position: "absolute",
                                  width: 256,
                                  height: 256,
                                  left: t.left,
                                  top: t.top,
                                }}
                              />
                            ))
                          : null}
                        {mapTiles ? (
                          <View
                            style={[
                              styles.mapPin,
                              {
                                left: mapTiles.pinLeft,
                                top: mapTiles.pinTop,
                              },
                            ]}
                          >
                            <Ionicons
                              name="location-sharp"
                              size={28}
                              color={colors.red[500]}
                            />
                          </View>
                        ) : null}
                        <Text style={styles.mapAttribution}>
                          © OpenStreetMap
                        </Text>
                      </TouchableOpacity>
                    )
                  ) : null}
                </>
              ) : null}

              {/* No address yet and not editing */}
              {!job.collectionAddress && editAddress === null ? (
                <>
                  {job.customer?.address ? (
                    <TouchableOpacity
                      onPress={() => {
                        patchJob.mutate({
                          collectionAddress: job.customer!.address,
                        } as Partial<Job>);
                      }}
                      style={styles.addressSuggestion}
                    >
                      <Ionicons
                        name="location"
                        size={16}
                        color={colors.amber[600]}
                      />
                      <View style={styles.addressSuggestionContent}>
                        <Text style={styles.addressSuggestionLabel}>
                          Use customer address
                        </Text>
                        <Text
                          style={styles.addressSuggestionText}
                          numberOfLines={1}
                        >
                          {job.customer.address}
                        </Text>
                      </View>
                      <Ionicons
                        name="arrow-forward"
                        size={16}
                        color={theme.textMuted}
                      />
                    </TouchableOpacity>
                  ) : null}
                  <TouchableOpacity
                    onPress={() => setEditAddress("")}
                    style={styles.addressTappable}
                  >
                    <Ionicons
                      name="create-outline"
                      size={16}
                      color={theme.textMuted}
                    />
                    <Text
                      style={[
                        styles.addressTappableText,
                        { color: theme.textMuted },
                      ]}
                    >
                      Enter address...
                    </Text>
                  </TouchableOpacity>
                </>
              ) : null}

              {/* Editing mode (triggered by long press or tapping enter) */}
              {editAddress !== null ? (
                <Input
                  placeholder="Street, city, postal code"
                  value={editAddress}
                  onChangeText={setEditAddress}
                  onBlur={() => handleSaveAddress(editAddress)}
                  autoFocus
                />
              ) : null}
            </View>
          ) : null}
          <TouchableOpacity style={styles.row} onPress={() => openDatePicker("pickup")} activeOpacity={0.6}>
            <Text style={styles.label}>Pickup</Text>
            <View style={styles.dateValue}>
              <Text style={[styles.dateText, !job.pickupDate && { color: theme.textMuted }]}>
                {job.pickupDate ? formatDate(job.pickupDate) : "Set date"}
              </Text>
              <Ionicons name="calendar-outline" size={16} color={theme.textMuted} />
            </View>
          </TouchableOpacity>
          <TouchableOpacity style={styles.row} onPress={() => openDatePicker("dropOff")} activeOpacity={0.6}>
            <Text style={styles.label}>Drop-off</Text>
            <View style={styles.dateValue}>
              <Text style={[styles.dateText, !job.dropOffDate && { color: theme.textMuted }]}>
                {job.dropOffDate ? formatDate(job.dropOffDate) : "Set date"}
              </Text>
              <Ionicons name="calendar-outline" size={16} color={theme.textMuted} />
            </View>
          </TouchableOpacity>
        </Card>

        {/* Services */}
        {job.jobServices.length > 0 ? (
          <Card style={styles.section}>
            <Text style={styles.sectionTitle}>Services</Text>
            {job.jobServices.map((js) => (
              <View key={js.id} style={styles.lineItem}>
                <View style={styles.lineItemLeft}>
                  <Text style={styles.lineItemName}>{js.service.name}</Text>
                  {js.quantity > 1 ? (
                    <Text style={styles.lineItemQty}>x{js.quantity}</Text>
                  ) : null}
                </View>
                <Text style={styles.lineItemPrice}>
                  {formatCurrency(parseFloat(js.unitPrice) * js.quantity)}
                </Text>
              </View>
            ))}
          </Card>
        ) : null}

        {/* Products */}
        {job.jobProducts.length > 0 ? (
          <Card style={styles.section}>
            <Text style={styles.sectionTitle}>Products</Text>
            {job.jobProducts.map((jp) => (
              <View key={jp.id} style={styles.lineItem}>
                <View style={styles.lineItemLeft}>
                  <Text style={styles.lineItemName}>{jp.product.name}</Text>
                  {jp.quantity > 1 ? (
                    <Text style={styles.lineItemQty}>x{jp.quantity}</Text>
                  ) : null}
                </View>
                <Text style={styles.lineItemPrice}>
                  {formatCurrency(parseFloat(jp.unitPrice) * jp.quantity)}
                </Text>
              </View>
            ))}
          </Card>
        ) : null}

        {/* Total */}
        <Card style={styles.section}>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Total</Text>
            <Text style={styles.totalAmount}>{formatCurrency(total)}</Text>
          </View>
        </Card>

        {/* Notes */}
        {job.notes || job.customerNotes ? (
          <Card style={styles.section}>
            <Text style={styles.sectionTitle}>Notes</Text>
            {job.notes ? (
              <View style={styles.noteBlock}>
                <Text style={styles.noteLabel}>Notes</Text>
                <Text style={styles.noteText}>{job.notes}</Text>
              </View>
            ) : null}
            {job.customerNotes ? (
              <View style={styles.noteBlock}>
                <Text style={styles.noteLabel}>Customer Notes</Text>
                <Text style={styles.noteText}>{job.customerNotes}</Text>
              </View>
            ) : null}
          </Card>
        ) : null}

        {/* Internal Notes */}
        <Card style={styles.section}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing[2] }}>
            <Text style={styles.sectionTitle}>Internal Notes</Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: spacing[1], backgroundColor: colors.amber[100], paddingHorizontal: spacing[2], paddingVertical: 2, borderRadius: borderRadius.full }}>
              <Ionicons name="lock-closed" size={10} color={colors.amber[700]} />
              <Text style={{ fontSize: 10, lineHeight: 14, fontWeight: "700", color: colors.amber[700], textTransform: "uppercase", letterSpacing: 0.5 }}>Staff only</Text>
            </View>
          </View>
          <TextInput
            value={internalNotesValue}
            onChangeText={setInternalNotesValue}
            onBlur={handleSaveInternalNotes}
            placeholder="Add private notes about this job…"
            placeholderTextColor={theme.textSecondary}
            multiline
            numberOfLines={3}
            style={{
              ...fontSize.sm,
              color: theme.inputText,
              backgroundColor: theme.inputBg,
              borderWidth: 1,
              borderColor: theme.inputBorder,
              borderRadius: borderRadius.lg,
              padding: spacing[3],
              minHeight: 80,
              textAlignVertical: "top",
            }}
            editable={!savingInternalNotes}
          />
          {savingInternalNotes ? (
            <Text style={{ ...fontSize.xs, color: theme.textSecondary }}>Saving…</Text>
          ) : null}
        </Card>

        {/* Actions */}
        <View style={styles.actionsSection}>
          {job.customer ? (
            <Button
              title={openingChat ? "Opening…" : "Open Chat"}
              onPress={handleOpenChat}
              variant="secondary"
              disabled={openingChat}
            />
          ) : null}
          {job.stage !== "CANCELLED" ? (
            <Button
              title="Cancel Job"
              onPress={openCancelModal}
              variant="secondary"
            />
          ) : null}
          <Button
            title="Delete Job"
            onPress={handleDelete}
            variant="danger"
          />
        </View>
        </>
        )}
      </ScrollView>
      <ImageViewer uri={viewingImageUrl} onClose={() => setViewingImageUrl(null)} />

      {/* Action menu dropdown */}
      <Modal
        visible={showActionMenu}
        transparent
        animationType="none"
        statusBarTranslucent
        onRequestClose={closeActionMenu}
      >
        <Pressable style={actionMenuStyles.backdrop} onPress={closeActionMenu}>
          <Animated.View
            style={[
              actionMenuStyles.dropdown,
              {
                opacity: actionMenuOpacity,
                backgroundColor: theme.surface,
                shadowColor: "#000",
                shadowOpacity: theme.dark ? 0.4 : 0.15,
              },
            ]}
          >
            {job.stage !== "CANCELLED" ? (
              <TouchableOpacity
                onPress={openCancelModal}
                style={actionMenuStyles.menuItem}
                activeOpacity={0.6}
              >
                <Ionicons name="close-circle-outline" size={18} color={colors.amber[600]} />
                <Text style={[actionMenuStyles.menuLabel, { color: theme.text }]}>
                  Cancel Job
                </Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity
              onPress={handleDelete}
              style={[
                actionMenuStyles.menuItem,
                job.stage !== "CANCELLED" && {
                  borderTopWidth: StyleSheet.hairlineWidth,
                  borderTopColor: theme.surfaceBorder,
                },
              ]}
              activeOpacity={0.6}
            >
              <Ionicons name="trash-outline" size={18} color={colors.red[500]} />
              <Text style={[actionMenuStyles.menuLabel, { color: colors.red[500] }]}>
                Delete Job
              </Text>
            </TouchableOpacity>
          </Animated.View>
        </Pressable>
      </Modal>

      {/* Date picker */}
      <Modal
        visible={showDatePicker !== null}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => setShowDatePicker(null)}
      >
        <Pressable
          style={datePickerStyles.backdrop}
          onPress={() => setShowDatePicker(null)}
        >
          <Pressable
            style={[datePickerStyles.sheet, { backgroundColor: theme.surface }]}
            onPress={(e) => e.stopPropagation()}
          >
            <Text style={[datePickerStyles.title, { color: theme.textHeading }]}>
              {showDatePicker === "dropOff" ? "Drop-off Date" : "Pickup Date"}
            </Text>

            {/* Month / year navigation */}
            <View style={datePickerStyles.navRow}>
              <TouchableOpacity
                onPress={() => {
                  if (calMonth === 0) { setCalMonth(11); setCalYear(calYear - 1); }
                  else setCalMonth(calMonth - 1);
                }}
                style={datePickerStyles.navButton}
              >
                <Ionicons name="chevron-back" size={20} color={theme.text} />
              </TouchableOpacity>
              <Text style={[datePickerStyles.navLabel, { color: theme.text }]}>
                {new Date(calYear, calMonth).toLocaleString("en-US", { month: "long", year: "numeric" })}
              </Text>
              <TouchableOpacity
                onPress={() => {
                  if (calMonth === 11) { setCalMonth(0); setCalYear(calYear + 1); }
                  else setCalMonth(calMonth + 1);
                }}
                style={datePickerStyles.navButton}
              >
                <Ionicons name="chevron-forward" size={20} color={theme.text} />
              </TouchableOpacity>
            </View>

            {/* Day-of-week headers */}
            <View style={datePickerStyles.weekRow}>
              {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((d) => (
                <Text key={d} style={[datePickerStyles.weekDay, { color: theme.textMuted }]}>{d}</Text>
              ))}
            </View>

            {/* Calendar grid */}
            <View style={datePickerStyles.grid}>
              {calDays.map((day, i) => {
                if (day === null) return <View key={`b${i}`} style={datePickerStyles.cell} />;
                const isSelected = day === calSelectedDay;
                const isToday =
                  day === new Date().getDate() &&
                  calMonth === new Date().getMonth() &&
                  calYear === new Date().getFullYear();
                return (
                  <TouchableOpacity
                    key={day}
                    onPress={() => handleSelectDay(day)}
                    style={[
                      datePickerStyles.cell,
                      isSelected && { backgroundColor: colors.amber[500], borderRadius: borderRadius.full },
                      !isSelected && isToday && { borderWidth: 1, borderColor: colors.amber[400], borderRadius: borderRadius.full },
                    ]}
                    activeOpacity={0.6}
                  >
                    <Text
                      style={[
                        datePickerStyles.dayText,
                        { color: theme.text },
                        isSelected && { color: colors.white, fontWeight: "700" },
                      ]}
                    >
                      {day}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Footer actions */}
            <View style={datePickerStyles.actions}>
              {((showDatePicker === "dropOff" && job.dropOffDate) ||
                (showDatePicker === "pickup" && job.pickupDate)) ? (
                <TouchableOpacity
                  onPress={() => clearDate(showDatePicker!)}
                  style={datePickerStyles.clearButton}
                >
                  <Text style={[datePickerStyles.clearText, { color: colors.red[500] }]}>
                    Clear
                  </Text>
                </TouchableOpacity>
              ) : (
                <View />
              )}
              <Button
                title="Cancel"
                onPress={() => setShowDatePicker(null)}
                variant="ghost"
                size="md"
              />
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Reject booking modal */}
      <Modal
        visible={showRejectModal}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => setShowRejectModal(false)}
      >
        <Pressable
          style={cancelModalStyles.backdrop}
          onPress={() => setShowRejectModal(false)}
        >
          <Pressable
            style={[cancelModalStyles.sheet, { backgroundColor: theme.surface }]}
            onPress={(e) => e.stopPropagation()}
          >
            <Text style={[cancelModalStyles.title, { color: theme.textHeading }]}>
              Reject Booking
            </Text>
            <Text style={[cancelModalStyles.subtitle, { color: theme.textSecondary }]}>
              The customer will see this reason on the status page and by email.
            </Text>
            <TextInput
              style={[
                cancelModalStyles.textInput,
                {
                  color: theme.text,
                  backgroundColor: theme.inputBg,
                  borderColor: theme.inputBorder,
                },
              ]}
              placeholder="Reason for rejection..."
              placeholderTextColor={theme.textMuted}
              value={rejectReasonText}
              onChangeText={setRejectReasonText}
              multiline
              autoFocus
            />
            <View style={cancelModalStyles.actions}>
              <Button
                title="Go Back"
                onPress={() => setShowRejectModal(false)}
                variant="ghost"
                size="md"
              />
              <Button
                title={patchJob.isPending ? "Rejecting…" : "Reject"}
                onPress={handleRejectBooking}
                variant="danger"
                size="md"
                disabled={!rejectReasonText.trim() || patchJob.isPending}
              />
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Cancel job modal */}
      <Modal
        visible={showCancelModal}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => setShowCancelModal(false)}
      >
        <Pressable
          style={cancelModalStyles.backdrop}
          onPress={() => setShowCancelModal(false)}
        >
          <Pressable
            style={[cancelModalStyles.sheet, { backgroundColor: theme.surface }]}
            onPress={(e) => e.stopPropagation()}
          >
            <Text style={[cancelModalStyles.title, { color: theme.textHeading }]}>
              Cancel Job
            </Text>
            <Text style={[cancelModalStyles.subtitle, { color: theme.textSecondary }]}>
              Why is this job being cancelled?
            </Text>

            <View style={cancelModalStyles.options}>
              {CANCEL_REASONS.map((reason) => (
                <TouchableOpacity
                  key={reason}
                  onPress={() => setCancelReason(reason)}
                  style={[
                    cancelModalStyles.option,
                    {
                      backgroundColor:
                        cancelReason === reason ? colors.amber[50] : theme.subtleBg,
                      borderColor:
                        cancelReason === reason ? colors.amber[400] : theme.surfaceBorder,
                    },
                  ]}
                  activeOpacity={0.7}
                >
                  <Ionicons
                    name={cancelReason === reason ? "radio-button-on" : "radio-button-off"}
                    size={18}
                    color={cancelReason === reason ? colors.amber[500] : theme.textMuted}
                  />
                  <Text
                    style={[
                      cancelModalStyles.optionText,
                      { color: cancelReason === reason ? theme.text : theme.textTertiary },
                    ]}
                  >
                    {reason}
                  </Text>
                </TouchableOpacity>
              ))}
              <TouchableOpacity
                onPress={() => setCancelReason("Other")}
                style={[
                  cancelModalStyles.option,
                  {
                    backgroundColor:
                      cancelReason === "Other" ? colors.amber[50] : theme.subtleBg,
                    borderColor:
                      cancelReason === "Other" ? colors.amber[400] : theme.surfaceBorder,
                  },
                ]}
                activeOpacity={0.7}
              >
                <Ionicons
                  name={cancelReason === "Other" ? "radio-button-on" : "radio-button-off"}
                  size={18}
                  color={cancelReason === "Other" ? colors.amber[500] : theme.textMuted}
                />
                <Text
                  style={[
                    cancelModalStyles.optionText,
                    { color: cancelReason === "Other" ? theme.text : theme.textTertiary },
                  ]}
                >
                  Other
                </Text>
              </TouchableOpacity>
            </View>

            {cancelReason === "Other" ? (
              <TextInput
                style={[
                  cancelModalStyles.textInput,
                  {
                    color: theme.text,
                    backgroundColor: theme.inputBg,
                    borderColor: theme.inputBorder,
                  },
                ]}
                placeholder="Describe the reason..."
                placeholderTextColor={theme.textMuted}
                value={cancelReasonText}
                onChangeText={setCancelReasonText}
                multiline
                autoFocus
              />
            ) : null}

            <View style={cancelModalStyles.actions}>
              <Button
                title="Go Back"
                onPress={() => setShowCancelModal(false)}
                variant="ghost"
                size="md"
              />
              <Button
                title="Cancel Job"
                onPress={handleCancelJob}
                variant="danger"
                size="md"
                disabled={!cancelReason}
              />
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const actionMenuStyles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.2)",
    justifyContent: "flex-start",
    alignItems: "flex-end",
  },
  dropdown: {
    marginTop: 100,
    marginRight: spacing[3],
    borderRadius: borderRadius.xl,
    minWidth: 190,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 12,
    elevation: 8,
  },
  menuItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    paddingVertical: spacing[3],
    paddingHorizontal: spacing[4],
  },
  menuLabel: {
    ...fontSize.base,
    fontWeight: "500",
  },
});

const datePickerStyles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
    padding: spacing[4],
  },
  sheet: {
    width: "100%",
    maxWidth: 360,
    borderRadius: borderRadius.xl,
    padding: spacing[4],
    gap: spacing[2],
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.2,
    shadowRadius: 24,
    elevation: 12,
  },
  title: {
    ...fontSize.lg,
    fontWeight: "700",
    textAlign: "center",
  },
  navRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  navButton: {
    padding: spacing[2],
  },
  navLabel: {
    ...fontSize.base,
    fontWeight: "600",
  },
  weekRow: {
    flexDirection: "row",
  },
  weekDay: {
    width: `${100 / 7}%`,
    textAlign: "center",
    ...fontSize.xs,
    fontWeight: "600",
    paddingVertical: spacing[1],
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  cell: {
    width: `${100 / 7}%`,
    aspectRatio: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  dayText: {
    ...fontSize.sm,
  },
  actions: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: spacing[1],
  },
  clearButton: {
    paddingVertical: spacing[2],
    paddingHorizontal: spacing[1],
  },
  clearText: {
    ...fontSize.sm,
    fontWeight: "600",
  },
});

const cancelModalStyles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
    padding: spacing[4],
  },
  sheet: {
    width: "100%",
    maxWidth: 400,
    borderRadius: borderRadius.xl,
    padding: spacing[5],
    gap: spacing[3],
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.2,
    shadowRadius: 24,
    elevation: 12,
  },
  title: {
    ...fontSize.lg,
    fontWeight: "700",
  },
  subtitle: {
    ...fontSize.sm,
  },
  options: {
    gap: spacing[2],
  },
  option: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2.5],
    paddingVertical: spacing[2.5],
    paddingHorizontal: spacing[3],
    borderRadius: borderRadius.lg,
    borderWidth: 1,
  },
  optionText: {
    ...fontSize.sm,
    fontWeight: "500",
    flex: 1,
  },
  textInput: {
    ...fontSize.sm,
    borderWidth: 1,
    borderRadius: borderRadius.lg,
    padding: spacing[3],
    minHeight: 80,
    textAlignVertical: "top",
  },
  actions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: spacing[2],
    marginTop: spacing[1],
  },
});
