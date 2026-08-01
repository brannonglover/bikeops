import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  BackHandler,
  Alert,
  RefreshControl,
  StyleSheet,
  Image,
  Animated,
  ActivityIndicator,
  Platform,
  Keyboard,
  Linking,
  Modal,
  Pressable,
  KeyboardAvoidingView,
  TextInput,
} from "react-native";
import { useLocalSearchParams, useRouter, Stack, useFocusEffect } from "expo-router";
import { useQuery, useMutation, useQueryClient, replaceEqualDeep } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/lib/api";
import { type Job, type JobBike, type Stage, type DeliveryType, type Conversation, STAGE_LABELS, STAGE_COLORS } from "@/lib/types";
import { colors, spacing, fontSize, borderRadius } from "@/lib/theme";
import { useTheme } from "@/lib/ThemeContext";
import { Card } from "@/components/ui/Card";
import { StageBadge } from "@/components/ui/Badge";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { LoadingScreen } from "@/components/ui/LoadingScreen";
import { ImageViewer } from "@/components/ui/ImageViewer";
import { InvoiceTab } from "@/components/jobs/InvoiceTab";
import { useResponsiveLayout } from "@/hooks/useResponsiveLayout";
import { mergeBoardJob, sanitizeWorkingOnJobBikeId } from "@/lib/board-stage-merge";
import { syncJobToCaches } from "@/lib/job-cache-sync";
import {
  customerName,
  getJobBikeDisplayTitle,
  getPrimaryJobBike,
  formatDate,
  formatPhoneNumber,
} from "@/lib/format";
import { AppleMaps } from "expo-maps";
import * as Device from "expo-device";
import { useJobBikeImageUpload } from "@/hooks/useJobBikeImageUpload";
import { showEmailAppPicker } from "@/lib/open-email";

type Tab = "overview" | "invoice" | "notes";

function getJobRepairNumber(jobId: string): string {
  const short = jobId.replace(/-/g, "").slice(-4).toUpperCase();
  return `R-${short}`;
}

function formatCheckedIn(dateStr: string | null | undefined): string {
  if (!dateStr) return "Not checked in";
  const d = new Date(dateStr);
  const date = d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const time = d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
  return `${date} • ${time}`;
}

const HERO_META_SEPARATOR = " · ";

function getJobBikeMetaParts(jb: JobBike): string[] {
  return [
    jb.bikeType === "E_BIKE" ? "E-Bike" : jb.bikeType === "REGULAR" ? "Regular" : null,
    jb.nickname?.trim() || null,
  ].filter(Boolean) as string[];
}

type JobBikeStatus = "queued" | "working" | "waiting" | "done";

const JOB_BIKE_STATUSES: JobBikeStatus[] = ["queued", "working", "waiting", "done"];

const JOB_BIKE_STATUS_LABELS: Record<JobBikeStatus, string> = {
  queued: "Queued",
  working: "Working on",
  waiting: "Waiting on parts",
  done: "Done",
};

const JOB_BIKE_STATUS_COLORS: Record<JobBikeStatus, string> = {
  queued: colors.slate[400],
  working: colors.amber[600],
  waiting: colors.red[500],
  done: colors.emerald[600],
};

function getEffectiveWorkingOnJobBikeId(job: Job): string | null {
  if (job.stage === "BIKE_READY" || job.stage === "COMPLETED") return null;
  return sanitizeWorkingOnJobBikeId(job.workingOnJobBikeId, job.jobBikes);
}

function getJobBikeStatus(jb: JobBike, job: Job): JobBikeStatus {
  if (jb.completedAt) return "done";
  if (job.stage === "BIKE_READY" || job.stage === "COMPLETED") {
    if (jb.waitingOnPartsAt) return "waiting";
    return "queued";
  }
  const workingOnJobBikeId = getEffectiveWorkingOnJobBikeId(job);
  if (workingOnJobBikeId === jb.id) return "working";
  if (jb.waitingOnPartsAt) return "waiting";
  return "queued";
}

/** Stages the PATCH API accepts (excludes CANCELLED — needs reason via cancel flow). */
const PATCHABLE_STAGES: Stage[] = [
  "BOOKED_IN",
  "RECEIVED",
  "WORKING_ON",
  "WAITING_ON_CUSTOMER",
  "WAITING_ON_PARTS",
  "BIKE_READY",
  "COMPLETED",
];

function stageOptionsForJob(job: Job): Stage[] {
  if (job.stage === "PENDING_APPROVAL") {
    return ["PENDING_APPROVAL", ...PATCHABLE_STAGES];
  }
  return PATCHABLE_STAGES;
}

const MAP_HEIGHT = 150;
const MAP_ZOOM = 15;

type JobPatchBody = Partial<Job> & {
  completeJobBikeId?: string;
  uncompleteJobBikeId?: string;
  waitForPartsJobBikeId?: string;
  unwaitForPartsJobBikeId?: string;
};

function applyJobPatchOptimistically(job: Job, patch: JobPatchBody): Job {
  const nowIso = new Date().toISOString();
  // Drop patch-only control fields so they are not stored on the cached Job.
  const {
    completeJobBikeId: _completeJobBikeId,
    uncompleteJobBikeId: _uncompleteJobBikeId,
    waitForPartsJobBikeId: _waitForPartsJobBikeId,
    unwaitForPartsJobBikeId: _unwaitForPartsJobBikeId,
    ...jobFields
  } = patch;
  const next: Job = { ...job, ...jobFields, updatedAt: nowIso };

  if (patch.completeJobBikeId) {
    next.jobBikes = (next.jobBikes ?? []).map((jb) =>
      jb.id === patch.completeJobBikeId
        ? { ...jb, completedAt: nowIso, waitingOnPartsAt: null }
        : jb
    );
  }
  if (patch.uncompleteJobBikeId) {
    next.jobBikes = (next.jobBikes ?? []).map((jb) =>
      jb.id === patch.uncompleteJobBikeId ? { ...jb, completedAt: null } : jb
    );
  }
  if (patch.waitForPartsJobBikeId) {
    next.jobBikes = (next.jobBikes ?? []).map((jb) =>
      jb.id === patch.waitForPartsJobBikeId
        ? { ...jb, waitingOnPartsAt: nowIso }
        : jb
    );
  }
  if (patch.unwaitForPartsJobBikeId) {
    next.jobBikes = (next.jobBikes ?? []).map((jb) =>
      jb.id === patch.unwaitForPartsJobBikeId
        ? { ...jb, waitingOnPartsAt: null }
        : jb
    );
  }

  if (
    next.stage === "BIKE_READY" ||
    next.stage === "COMPLETED" ||
    next.stage === "WAITING_ON_PARTS" ||
    next.stage === "WAITING_ON_CUSTOMER"
  ) {
    next.workingOnJobBikeId = null;
  } else {
    next.workingOnJobBikeId = sanitizeWorkingOnJobBikeId(
      next.workingOnJobBikeId,
      next.jobBikes
    );
  }

  return next;
}

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
  const layout = useResponsiveLayout();
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [openStageMenu, setOpenStageMenu] = useState(false);
  const [openBikeStatusMenuId, setOpenBikeStatusMenuId] = useState<string | null>(null);
  const [savingBikeStatusId, setSavingBikeStatusId] = useState<string | null>(null);
  const [viewingImageUrl, setViewingImageUrl] = useState<string | null>(null);
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
  const [collPickupFrom, setCollPickupFrom] = useState("");
  const [collPickupTo, setCollPickupTo] = useState("");
  const [collReturnFrom, setCollReturnFrom] = useState("");
  const [collReturnTo, setCollReturnTo] = useState("");
  const [activeTab, setActiveTab] = useState<Tab>("overview");
  const [internalNotesValue, setInternalNotesValue] = useState("");
  const [savingInternalNotes, setSavingInternalNotes] = useState(false);
  const [openingChat, setOpeningChat] = useState(false);
  const { uploadingBikeImageId, showBikeImageActionSheet } = useJobBikeImageUpload(id ?? "");

  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: {
          flex: 1,
          backgroundColor: theme.background,
        },
        content: {
          padding: layout.isTablet ? spacing[6] : spacing[4],
          gap: spacing[3],
          paddingBottom: spacing[12],
          width: "100%",
          maxWidth: layout.isTablet ? layout.contentMaxWidth : undefined,
          alignSelf: "center",
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
        queuedBadge: {
          flexDirection: "row",
          alignItems: "center",
          gap: 3,
          backgroundColor: theme.dark ? colors.slate[700] : colors.slate[200],
          paddingHorizontal: spacing[1.5],
          paddingVertical: 2,
          borderRadius: borderRadius.md,
        },
        queuedBadgeText: {
          fontSize: 10,
          fontWeight: "700",
          color: theme.dark ? colors.slate[300] : colors.slate[600],
          textTransform: "uppercase",
          letterSpacing: 0.5,
        },
        bikeStatusSelector: {
          flexDirection: "row",
          alignItems: "center",
          gap: spacing[1],
          flexShrink: 0,
        },
        bikeStatusMenu: {
          marginTop: spacing[1.5],
          backgroundColor: theme.background,
          borderRadius: borderRadius.lg,
          padding: spacing[1],
          gap: spacing[0.5],
        },
        heroBikeModelRow: {
          flexDirection: "row",
          alignItems: "center",
          flexWrap: "wrap",
          gap: spacing[2],
        },
        buttonDisabled: {
          opacity: 0.5,
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
        windowRow: {
          paddingLeft: spacing[3],
          marginTop: -spacing[1],
          marginBottom: spacing[1],
        },
        windowLabel: {
          ...fontSize.xs,
          marginBottom: spacing[1],
        },
        windowInputs: {
          flexDirection: "row" as const,
          alignItems: "center" as const,
          gap: spacing[2],
        },
        windowInput: {
          flex: 1,
        },
        windowDash: {
          ...fontSize.base,
          fontWeight: "500" as const,
        },
        actionsSection: {
          gap: spacing[3],
          marginTop: spacing[2],
        },
        tabBar: {
          flexDirection: "row",
          marginTop: spacing[4],
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
          borderBottomColor: colors.emerald[500],
        },
        tabTextActive: {
          color: colors.emerald[500],
          fontWeight: "600",
        },
        heroSection: {
          gap: spacing[3],
        },
        heroImage: {
          width: "100%",
          height: 200,
          borderRadius: borderRadius.xl,
          backgroundColor: theme.placeholderBg,
        },
        heroImagePlaceholder: {
          width: "100%",
          height: 200,
          borderRadius: borderRadius.xl,
          backgroundColor: theme.placeholderBg,
          alignItems: "center",
          justifyContent: "center",
        },
        heroBrand: {
          ...fontSize.xs,
          fontWeight: "600",
          color: theme.text,
          letterSpacing: 2,
          textTransform: "uppercase",
        },
        heroTitleRow: {
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: spacing[3],
        },
        heroModel: {
          ...fontSize["2xl"],
          fontWeight: "700",
          color: theme.text,
          flexShrink: 1,
        },
        heroModelBlock: {
          flex: 1,
          gap: spacing[1],
        },
        heroMetaRow: {
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: spacing[3],
        },
        heroMeta: {
          ...fontSize.sm,
          fontWeight: "400",
          color: theme.textSecondary,
          flex: 1,
        },
        heroRepairId: {
          ...fontSize.xs,
          color: theme.textMuted,
          textAlign: "right",
        },
        heroBikeRow: {
          flexDirection: "row",
          alignItems: "center",
          gap: spacing[3],
        },
        heroBikeThumb: {
          width: 88,
          height: 88,
          borderRadius: borderRadius.xl,
          backgroundColor: theme.placeholderBg,
        },
        heroBikeThumbPlaceholder: {
          width: 88,
          height: 88,
          borderRadius: borderRadius.xl,
          backgroundColor: theme.placeholderBg,
          alignItems: "center",
          justifyContent: "center",
        },
        heroImageWrap: {
          position: "relative",
        },
        heroImageBadge: {
          position: "absolute",
          bottom: spacing[2],
          right: spacing[2],
          width: 32,
          height: 32,
          borderRadius: borderRadius.full,
          backgroundColor: "rgba(0,0,0,0.55)",
          alignItems: "center",
          justifyContent: "center",
          borderWidth: 1,
          borderColor: "rgba(255,255,255,0.25)",
        },
        heroThumbBadge: {
          position: "absolute",
          bottom: spacing[1],
          right: spacing[1],
          width: 26,
          height: 26,
          borderRadius: borderRadius.full,
          backgroundColor: "rgba(0,0,0,0.55)",
          alignItems: "center",
          justifyContent: "center",
          borderWidth: 1,
          borderColor: "rgba(255,255,255,0.25)",
        },
        heroImageUploadOverlay: {
          ...StyleSheet.absoluteFillObject,
          borderRadius: borderRadius.xl,
          backgroundColor: "rgba(0,0,0,0.45)",
          alignItems: "center",
          justifyContent: "center",
        },
        heroBikeList: {
          gap: spacing[3],
        },
        overviewCustomerBlock: {
          gap: spacing[2],
        },
        priorityBadge: {
          flexDirection: "row",
          alignItems: "center",
          gap: spacing[1],
          backgroundColor: theme.dark ? colors.amber[800] : colors.amber[100],
          paddingHorizontal: spacing[2.5],
          paddingVertical: spacing[1],
          borderRadius: borderRadius.full,
        },
        priorityBadgeText: {
          ...fontSize.xs,
          fontWeight: "700",
          color: theme.dark ? colors.amber[300] : colors.amber[800],
        },
        overviewField: {
          gap: spacing[1],
        },
        overviewLabel: {
          ...fontSize.xs,
          fontWeight: "600",
          color: theme.textMuted,
          textTransform: "uppercase",
          letterSpacing: 0.5,
        },
        overviewValue: {
          ...fontSize.base,
          color: theme.text,
        },
        overviewValueRow: {
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: spacing[2],
        },
        invoiceContainer: {
          padding: layout.isTablet ? spacing[6] : spacing[4],
          paddingBottom: spacing[12],
          width: "100%",
          maxWidth: layout.isTablet ? layout.contentMaxWidth : undefined,
          alignSelf: "center",
        },
      }),
    [layout.contentMaxWidth, layout.isTablet, theme]
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
    structuralSharing: (prev: unknown, next: unknown) => {
      if (!prev || !next) return replaceEqualDeep(prev, next);
      return mergeBoardJob(prev as Job, next as Job);
    },
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
    mutationFn: async (body: JobPatchBody) => {
      const { data } = await api.patch<Job>(`/api/jobs/${id}`, body);
      return data;
    },
    onMutate: async (body) => {
      await queryClient.cancelQueries({ queryKey: ["job", id] });
      await queryClient.cancelQueries({ queryKey: ["jobs"] });

      const prevJob = queryClient.getQueryData<Job>(["job", id]);
      const prevJobs = queryClient.getQueryData<Job[]>(["jobs"]);

      if (prevJob) {
        const optimistic = applyJobPatchOptimistically(prevJob, body);
        queryClient.setQueryData(["job", id], optimistic);
      }
      if (prevJobs && Array.isArray(prevJobs)) {
        queryClient.setQueryData(
          ["jobs"],
          prevJobs.map((j) =>
            j.id === id ? applyJobPatchOptimistically(j, body) : j
          )
        );
      }

      return { prevJob, prevJobs };
    },
    onError: (_err, _body, ctx) => {
      if (!ctx) return;
      if (ctx.prevJob) queryClient.setQueryData(["job", id], ctx.prevJob);
      if (ctx.prevJobs) queryClient.setQueryData(["jobs"], ctx.prevJobs);
    },
    onSuccess: (updated) => {
      const liveJob = queryClient.getQueryData<Job>(["job", id]);
      const merged = liveJob ? mergeBoardJob(liveJob, updated) : updated;
      queryClient.setQueryData(["job", id], merged);
      const prevJobs = queryClient.getQueryData<Job[]>(["jobs"]);
      if (prevJobs && Array.isArray(prevJobs)) {
        queryClient.setQueryData(
          ["jobs"],
          prevJobs.map((j) =>
            j.id === merged.id ? mergeBoardJob(j, merged) : j
          )
        );
      }
    },
  });

  useEffect(() => {
    setInternalNotesValue(job?.internalNotes ?? "");
    setCollPickupFrom(job?.collectionPickupWindowFrom ?? "");
    setCollPickupTo(job?.collectionPickupWindowTo ?? "");
    setCollReturnFrom(job?.collectionReturnWindowFrom ?? "");
    setCollReturnTo(job?.collectionReturnWindowTo ?? "");
  }, [job?.id]);

  const lastNonCompletedStageRef = useRef<Stage | null>(null);
  useEffect(() => {
    if (!job) return;
    if (job.stage !== "COMPLETED") lastNonCompletedStageRef.current = job.stage;
  }, [job?.stage, job?.id]);

  const prevPaymentStatusRef = useRef<Job["paymentStatus"] | null>(null);
  const prevPaymentStatus = prevPaymentStatusRef.current;
  useEffect(() => {
    prevPaymentStatusRef.current = job?.paymentStatus ?? null;
  }, [job?.id, job?.paymentStatus]);

  useEffect(() => {
    if (!job) return;
    if (patchJob.isPending) return;
    if (job.stage !== "COMPLETED") return;
    if (job.paymentStatus !== "PAID") return;
    // Only undo auto-completion that happened due to a payment event. If the
    // user manually marks the job as completed later, don't fight them.
    if (prevPaymentStatus === "PAID") return;
    const hasIncompleteBike = (job.jobBikes ?? []).some((jb) => !jb.completedAt);
    if (!hasIncompleteBike) return;

    const restoreStage = lastNonCompletedStageRef.current ?? "RECEIVED";
    if (restoreStage === "COMPLETED") return;
    patchJob.mutate(
      { stage: restoreStage, completedAt: null, notifyCustomer: false } as unknown as Partial<Job>
    );
  }, [job?.id, job?.stage, job?.paymentStatus, job?.jobBikes, patchJob.isPending]);

  const handleSaveInternalNotes = useCallback(async () => {
    if (!job) return;
    const trimmed = internalNotesValue.trim();
    const current = (job.internalNotes ?? "").trim();
    if (trimmed === current) return;
    setSavingInternalNotes(true);
    try {
      const nextInternalNotes = trimmed || null;
      await api.patch(`/api/jobs/${job.id}`, { internalNotes: nextInternalNotes });

      const prevJob = queryClient.getQueryData<Job>(["job", id]);
      if (prevJob) {
        queryClient.setQueryData(["job", id], { ...prevJob, internalNotes: nextInternalNotes });
      }
      const prevJobs = queryClient.getQueryData<Job[]>(["jobs"]);
      if (prevJobs && Array.isArray(prevJobs)) {
        queryClient.setQueryData(
          ["jobs"],
          prevJobs.map((j) => (j.id === job.id ? { ...j, internalNotes: nextInternalNotes } : j))
        );
      }
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
      goBackToJobBoard();
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
        const waitingBike = (job.jobBikes ?? []).find(
          (jb) => !!jb.waitingOnPartsAt && !jb.completedAt
        );
        if (waitingBike) {
          patch.unwaitForPartsJobBikeId = waitingBike.id;
          patch.workingOnJobBikeId = waitingBike.id;
        } else if (!job.workingOnJobBikeId) {
          const firstActive = (job.jobBikes ?? []).find((jb) => !jb.completedAt);
          if (firstActive) patch.workingOnJobBikeId = firstActive.id;
        }
      } else if (stage === "WAITING_ON_PARTS") {
        // Mirror what handleWaitForParts does: pick the currently active bike
        // (or the first non-completed one) so the per-bike badge updates too.
        const targetBike =
          (job.jobBikes ?? []).find((jb) => jb.id === job.workingOnJobBikeId) ??
          (job.jobBikes ?? []).find((jb) => !jb.completedAt);
        if (targetBike) patch.waitForPartsJobBikeId = targetBike.id;
        patch.workingOnJobBikeId = null;
      } else if (
        stage === "BIKE_READY" ||
        stage === "COMPLETED" ||
        stage === "CANCELLED"
      ) {
        patch.workingOnJobBikeId = null;
        // Single-bike jobs: Bike Ready also marks that bike Done.
        if (stage === "BIKE_READY") {
          const bikes = job.jobBikes ?? [];
          if (bikes.length === 1 && !bikes[0].completedAt) {
            patch.completeJobBikeId = bikes[0].id;
          }
        }
      }

      patchJob.mutate(patch as unknown as Partial<Job>);
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

  const isCollection = job?.deliveryType === "COLLECTION_SERVICE";

  const handleDeliveryTypeChange = useCallback(
    (newType: DeliveryType) => {
      if (!job || job.deliveryType === newType) return;
      const patch: Record<string, unknown> = { deliveryType: newType };
      if (newType === "DROP_OFF_AT_SHOP") {
        patch.collectionAddress = null;
        patch.collectionPickupWindowFrom = null;
        patch.collectionPickupWindowTo = null;
        patch.collectionReturnWindowFrom = null;
        patch.collectionReturnWindowTo = null;
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

  const handleBikeStatusChange = useCallback(
    (bikeId: string, targetStatus: JobBikeStatus) => {
      if (!job || savingBikeStatusId) return;
      const jb = (job.jobBikes ?? []).find((b) => b.id === bikeId);
      if (!jb) return;

      const currentStatus = getJobBikeStatus(jb, job);
      if (currentStatus === targetStatus) {
        setOpenBikeStatusMenuId(null);
        return;
      }

      setSavingBikeStatusId(bikeId);
      const patch: Record<string, unknown> = {};
      const effectiveWorkingOn = getEffectiveWorkingOnJobBikeId(job);

      switch (targetStatus) {
        case "queued":
          if (jb.completedAt) patch.uncompleteJobBikeId = bikeId;
          if (jb.waitingOnPartsAt) patch.unwaitForPartsJobBikeId = bikeId;
          if (effectiveWorkingOn === bikeId) patch.workingOnJobBikeId = null;
          break;
        case "working":
          if (jb.completedAt) patch.uncompleteJobBikeId = bikeId;
          if (jb.waitingOnPartsAt) patch.unwaitForPartsJobBikeId = bikeId;
          patch.workingOnJobBikeId = bikeId;
          if (
            job.stage !== "WORKING_ON" &&
            job.stage !== "CANCELLED" &&
            job.stage !== "COMPLETED"
          ) {
            patch.stage = "WORKING_ON";
            patch.notifyCustomer = false;
          }
          break;
        case "waiting":
          if (jb.completedAt) {
            setSavingBikeStatusId(null);
            return;
          }
          patch.waitForPartsJobBikeId = bikeId;
          if (effectiveWorkingOn === bikeId) patch.workingOnJobBikeId = null;
          // Mirror web handleWaitForParts: move the job column so web/board sync.
          if (
            job.stage !== "WAITING_ON_PARTS" &&
            job.stage !== "CANCELLED" &&
            job.stage !== "COMPLETED"
          ) {
            patch.stage = "WAITING_ON_PARTS";
          }
          break;
        case "done":
          patch.completeJobBikeId = bikeId;
          {
            const completedAfterIds = new Set(
              (job.jobBikes ?? [])
                .filter((b) => !!b.completedAt || b.id === bikeId)
                .map((b) => b.id)
            );
            const allCompletedAfter = (job.jobBikes ?? []).every((b) =>
              completedAfterIds.has(b.id)
            );
            if (allCompletedAfter) {
              patch.stage = "BIKE_READY";
              patch.workingOnJobBikeId = null;
              patch.completedAt = null;
            } else if (
              effectiveWorkingOn === bikeId ||
              (job.workingOnJobBikeId != null &&
                completedAfterIds.has(job.workingOnJobBikeId))
            ) {
              const nextActive = (job.jobBikes ?? []).find(
                (b) => !completedAfterIds.has(b.id)
              );
              patch.workingOnJobBikeId = nextActive?.id ?? null;
            }
          }
          break;
      }

      patchJob.mutate(patch as unknown as Partial<Job>, {
        onSettled: () => setSavingBikeStatusId(null),
      });
      setOpenBikeStatusMenuId(null);
    },
    [job, savingBikeStatusId, patchJob]
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

  const openCustomerAddressMaps = useCallback(() => {
    const address = job?.customer?.address;
    if (!address) return;
    const encoded = encodeURIComponent(address);
    Alert.alert("Open in Maps", address, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Apple Maps",
        onPress: () => Linking.openURL(`http://maps.apple.com/?q=${encoded}`),
      },
      {
        text: "Google Maps",
        onPress: () =>
          Linking.openURL(
            `https://www.google.com/maps/search/?api=1&query=${encoded}`
          ),
      },
    ]);
  }, [job?.customer?.address]);

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
      syncJobToCaches(queryClient, id, updated);
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
        router.push({
          pathname: "/(staff)/chat/[id]",
          params: { id: fromCache.id, fromJobId: job.id },
        } as never);
        return;
      }

      type CustomerConvPreview = { conversation: { id: string } | null };
      const { data: preview } = await api.get<CustomerConvPreview>(
        `/api/conversations/by-customer/${job.customer!.id}`
      );
      if (preview?.conversation?.id) {
        router.push({
          pathname: "/(staff)/chat/[id]",
          params: { id: preview.conversation.id, fromJobId: job.id },
        } as never);
        return;
      }

      const { data: newConv } = await api.post<Conversation>("/api/conversations", {
        customerId: job.customer!.id,
        jobId: null,
      });
      router.push({
        pathname: "/(staff)/chat/[id]",
        params: { id: newConv.id, fromJobId: job.id },
      } as never);
    } catch {
      Alert.alert("Error", "Failed to open chat");
    } finally {
      setOpeningChat(false);
    }
  }, [job, openingChat, queryClient, router]);

  const handleBikeImagePress = useCallback(
    (jb: JobBike) => {
      showBikeImageActionSheet(jb, setViewingImageUrl);
    },
    [showBikeImageActionSheet]
  );

  const goBackToJobBoard = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.navigate("/(staff)/(jobs)" as never);
    }
  }, [router]);

  const handleBack = useCallback(() => {
    Keyboard.dismiss();

    if (showRejectModal) {
      setShowRejectModal(false);
      return;
    }
    if (showCancelModal) {
      setShowCancelModal(false);
      return;
    }
    if (showDatePicker !== null) {
      setShowDatePicker(null);
      return;
    }
    if (viewingImageUrl) {
      setViewingImageUrl(null);
      return;
    }
    if (showActionMenu) {
      closeActionMenu();
      return;
    }
    if (openStageMenu && activeTab === "overview") {
      setOpenStageMenu(false);
      return;
    }
    if (openBikeStatusMenuId && activeTab === "overview") {
      setOpenBikeStatusMenuId(null);
      return;
    }

    goBackToJobBoard();
  }, [
    activeTab,
    showRejectModal,
    showCancelModal,
    showDatePicker,
    viewingImageUrl,
    showActionMenu,
    openStageMenu,
    openBikeStatusMenuId,
    closeActionMenu,
    goBackToJobBoard,
  ]);

  useFocusEffect(
    useCallback(() => {
      if (Platform.OS !== "android") return;
      const sub = BackHandler.addEventListener("hardwareBackPress", () => {
        handleBack();
        return true;
      });
      return () => sub.remove();
    }, [handleBack])
  );

  if (isLoading || !job) return <LoadingScreen message="Loading job..." />;

  const jobBikes = job.jobBikes ?? [];
  const sortedJobBikes = [...jobBikes].sort((a, b) => a.sortOrder - b.sortOrder);
  const hasMultipleBikes = sortedJobBikes.length > 1;
  const primaryBike = getPrimaryJobBike(job);
  const heroMake = (primaryBike?.make ?? job.bikeMake ?? "Bike").toUpperCase();
  const heroModel = primaryBike?.model ?? job.bikeModel ?? "";
  const heroImageUrl = primaryBike?.imageUrl ?? jobBikes.find((b) => b.imageUrl)?.imageUrl ?? null;
  const heroMetaParts = primaryBike ? getJobBikeMetaParts(primaryBike) : [];
  const checkedInDate = job.dropOffDate ?? (job.stage === "RECEIVED" || job.stage === "WORKING_ON" ? job.createdAt : null);
  const canEditStage = job.stage !== "CANCELLED" && job.stage !== "COMPLETED";
  const canEditBikeStatus = job.stage !== "CANCELLED" && job.stage !== "COMPLETED";
  const stageOptions = stageOptionsForJob(job);

  const renderHeroBikeImage = (
    jb: JobBike,
    variant: "hero" | "thumb",
    imageUrl: string | null
  ) => {
    const isUploading = uploadingBikeImageId === jb.id;
    const imageStyle = variant === "hero" ? styles.heroImage : styles.heroBikeThumb;
    const placeholderStyle =
      variant === "hero" ? styles.heroImagePlaceholder : styles.heroBikeThumbPlaceholder;
    const badgeStyle = variant === "hero" ? styles.heroImageBadge : styles.heroThumbBadge;
    const badgeIconSize = variant === "hero" ? 16 : 14;
    const placeholderIconSize = variant === "hero" ? 48 : 28;

    return (
      <TouchableOpacity
        activeOpacity={0.9}
        onPress={() => handleBikeImagePress(jb)}
        disabled={!!isUploading}
        accessibilityRole="button"
        accessibilityLabel={imageUrl ? "Change bike photo" : "Add bike photo"}
      >
        <View style={styles.heroImageWrap}>
          {imageUrl ? (
            <Image source={{ uri: imageUrl }} style={imageStyle} />
          ) : (
            <View style={placeholderStyle}>
              <Ionicons name="bicycle" size={placeholderIconSize} color={theme.iconMuted} />
            </View>
          )}
          {isUploading ? (
            <View style={[styles.heroImageUploadOverlay, imageStyle]}>
              <ActivityIndicator size="small" color={colors.white} />
            </View>
          ) : (
            <View style={badgeStyle}>
              <Ionicons name="camera" size={badgeIconSize} color={colors.white} />
            </View>
          )}
        </View>
      </TouchableOpacity>
    );
  };

  const renderStageSelector = (compact = true) => {
    if (!canEditStage) {
      return <StageBadge stage={job.stage} />;
    }

    return (
      <TouchableOpacity
        onPress={() => {
          setOpenBikeStatusMenuId(null);
          setOpenStageMenu((open) => !open);
        }}
        disabled={patchJob.isPending}
        style={[styles.bikeStatusSelector, patchJob.isPending && styles.buttonDisabled]}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel="Change job status"
      >
        <StageBadge stage={job.stage} />
        <Ionicons name="chevron-down" size={compact ? 12 : 14} color={theme.textMuted} />
      </TouchableOpacity>
    );
  };

  const renderStageMenu = () => {
    if (!canEditStage || !openStageMenu) return null;

    return (
      <View style={styles.bikeStatusMenu}>
        {stageOptions.map((stage) => (
          <TouchableOpacity
            key={stage}
            onPress={() => {
              setOpenStageMenu(false);
              if (stage !== job.stage) handleStageChange(stage);
            }}
            disabled={patchJob.isPending}
            style={[
              styles.stageOption,
              job.stage === stage && styles.stageOptionActive,
              patchJob.isPending && styles.buttonDisabled,
            ]}
          >
            <View style={[styles.stageDot, { backgroundColor: STAGE_COLORS[stage] }]} />
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
    );
  };

  const renderBikeStatusBadge = (status: JobBikeStatus, compact?: boolean) => {
    switch (status) {
      case "done":
        return (
          <View style={styles.doneBadge}>
            <Ionicons name="checkmark" size={compact ? 9 : 10} color={colors.emerald[700]} />
            <Text style={styles.doneBadgeText}>{JOB_BIKE_STATUS_LABELS.done}</Text>
          </View>
        );
      case "waiting":
        return (
          <View style={styles.waitingBadge}>
            <Ionicons name="time" size={compact ? 9 : 10} color={colors.red[700]} />
            <Text style={styles.waitingBadgeText}>{JOB_BIKE_STATUS_LABELS.waiting}</Text>
          </View>
        );
      case "working":
        return (
          <View style={styles.workingOnBadge}>
            {!compact ? <PulsingDot color={colors.amber[600]} /> : null}
            <Text style={styles.workingOnBadgeText}>{JOB_BIKE_STATUS_LABELS.working}</Text>
          </View>
        );
      default:
        return (
          <View style={styles.queuedBadge}>
            <Ionicons name="ellipse-outline" size={compact ? 9 : 10} color={theme.dark ? colors.slate[400] : colors.slate[500]} />
            <Text style={styles.queuedBadgeText}>{JOB_BIKE_STATUS_LABELS.queued}</Text>
          </View>
        );
    }
  };

  const renderBikeStatusBadgeControl = (jb: JobBike, compact = true) => {
    const bikeStatus = getJobBikeStatus(jb, job);
    const isStatusMenuOpen = openBikeStatusMenuId === jb.id;
    const isSavingStatus = savingBikeStatusId === jb.id;

    if (!canEditBikeStatus) {
      return renderBikeStatusBadge(bikeStatus, compact);
    }

    return (
      <TouchableOpacity
        onPress={() => {
          setOpenStageMenu(false);
          setOpenBikeStatusMenuId(isStatusMenuOpen ? null : jb.id);
        }}
        disabled={!!isSavingStatus}
        style={[styles.bikeStatusSelector, isSavingStatus && styles.buttonDisabled]}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel="Change bike status"
      >
        {renderBikeStatusBadge(bikeStatus, compact)}
        <Ionicons name="chevron-down" size={compact ? 12 : 14} color={theme.textMuted} />
      </TouchableOpacity>
    );
  };

  const renderBikeStatusMenu = (jb: JobBike) => {
    if (!canEditBikeStatus || openBikeStatusMenuId !== jb.id) return null;

    const bikeStatus = getJobBikeStatus(jb, job);
    const isSavingStatus = savingBikeStatusId === jb.id;

    return (
      <View style={styles.bikeStatusMenu}>
        {JOB_BIKE_STATUSES.map((status) => (
          <TouchableOpacity
            key={status}
            onPress={() => handleBikeStatusChange(jb.id, status)}
            disabled={!!isSavingStatus}
            style={[
              styles.stageOption,
              bikeStatus === status && styles.stageOptionActive,
              isSavingStatus && styles.buttonDisabled,
            ]}
          >
            <View style={[styles.stageDot, { backgroundColor: JOB_BIKE_STATUS_COLORS[status] }]} />
            <Text
              style={[
                styles.stageOptionText,
                bikeStatus === status && styles.stageOptionTextActive,
              ]}
            >
              {JOB_BIKE_STATUS_LABELS[status]}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    );
  };

  return (
    <>
      <Stack.Screen
        options={{
          title: "Edit Repair",
          headerBackVisible: false,
          headerLeft: () => (
            <TouchableOpacity
              onPress={handleBack}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              style={{ flexDirection: "row", alignItems: "center", gap: spacing[0.5], padding: spacing[1] }}
              accessibilityRole="button"
              accessibilityLabel="Back to Job Board"
            >
              <Ionicons name="chevron-back" size={24} color={theme.text} />
              <Text style={{ ...fontSize.base, color: theme.text }}>Back</Text>
            </TouchableOpacity>
          ),
          headerRight: () => (
            <TouchableOpacity onPress={openActionMenu} style={{ padding: spacing[2] }}>
              <Ionicons name="ellipsis-vertical" size={20} color={theme.text} />
            </TouchableOpacity>
          ),
        }}
      />
      <View style={{ flex: 1 }}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={
          activeTab === "invoice" ? styles.invoiceContainer : styles.content
        }
        refreshControl={
          <RefreshControl refreshing={isManualRefresh} onRefresh={handleRefresh} />
        }
      >
        {/* Hero */}
        <View style={styles.heroSection}>
          {hasMultipleBikes ? (
            <>
              <View style={styles.heroTitleRow}>
                <Text style={styles.heroBrand}>{sortedJobBikes.length} BIKES</Text>
                <View style={{ flexDirection: "row", alignItems: "center", gap: spacing[2] }}>
                  {renderStageSelector()}
                  {job.stage === "PENDING_APPROVAL" ? (
                    <View style={styles.priorityBadge}>
                      <Ionicons name="notifications" size={12} color={theme.dark ? colors.amber[300] : colors.amber[800]} />
                      <Text style={styles.priorityBadgeText}>Priority</Text>
                    </View>
                  ) : null}
                </View>
              </View>
              {renderStageMenu()}
              <View style={styles.heroBikeList}>
                {sortedJobBikes.map((jb) => {
                  const metaParts = getJobBikeMetaParts(jb);
                  return (
                    <View key={jb.id} style={styles.heroBikeRow}>
                      {renderHeroBikeImage(jb, "thumb", jb.imageUrl)}
                      <View style={{ flex: 1, gap: spacing[1] }}>
                        <Text style={styles.heroBrand}>{(jb.make ?? "Bike").toUpperCase()}</Text>
                        <View style={styles.heroBikeModelRow}>
                          <Text style={styles.heroModel} numberOfLines={2}>
                            {jb.model || jb.make}
                          </Text>
                          {renderBikeStatusBadgeControl(jb)}
                        </View>
                        {renderBikeStatusMenu(jb)}
                        {metaParts.length > 0 ? (
                          <Text style={styles.heroMeta} numberOfLines={1}>
                            {metaParts.join(HERO_META_SEPARATOR)}
                          </Text>
                        ) : null}
                      </View>
                    </View>
                  );
                })}
              </View>
              <View style={styles.heroMetaRow}>
                <View style={{ flex: 1 }} />
                <Text style={styles.heroRepairId}>Repair #{getJobRepairNumber(job.id)}</Text>
              </View>
            </>
          ) : (
            <>
              {primaryBike ? (
                renderHeroBikeImage(primaryBike, "hero", heroImageUrl)
              ) : heroImageUrl ? (
                <TouchableOpacity
                  activeOpacity={0.9}
                  onPress={() => setViewingImageUrl(heroImageUrl)}
                >
                  <Image source={{ uri: heroImageUrl }} style={styles.heroImage} />
                </TouchableOpacity>
              ) : (
                <View style={styles.heroImagePlaceholder}>
                  <Ionicons name="bicycle" size={48} color={theme.iconMuted} />
                </View>
              )}
              <Text style={styles.heroBrand}>{heroMake}</Text>
              <View style={styles.heroTitleRow}>
                <View style={styles.heroModelBlock}>
                  <View style={styles.heroBikeModelRow}>
                    <Text style={styles.heroModel} numberOfLines={2}>
                      {heroModel || getJobBikeDisplayTitle(job)}
                    </Text>
                    {primaryBike ? renderBikeStatusBadgeControl(primaryBike) : null}
                  </View>
                  {primaryBike ? renderBikeStatusMenu(primaryBike) : null}
                </View>
                <View style={{ flexDirection: "row", alignItems: "center", gap: spacing[2], flexShrink: 0 }}>
                  {renderStageSelector()}
                  {job.stage === "PENDING_APPROVAL" ? (
                    <View style={styles.priorityBadge}>
                      <Ionicons name="notifications" size={12} color={theme.dark ? colors.amber[300] : colors.amber[800]} />
                      <Text style={styles.priorityBadgeText}>Priority</Text>
                    </View>
                  ) : null}
                </View>
              </View>
              {renderStageMenu()}
              <View style={styles.heroMetaRow}>
                {heroMetaParts.length > 0 ? (
                  <Text style={styles.heroMeta} numberOfLines={1}>
                    {heroMetaParts.join(HERO_META_SEPARATOR)}
                  </Text>
                ) : (
                  <View style={{ flex: 1 }} />
                )}
                <Text style={styles.heroRepairId}>Repair #{getJobRepairNumber(job.id)}</Text>
              </View>
            </>
          )}
        </View>

        {/* Tab bar */}
        <View style={styles.tabBar}>
          <TouchableOpacity
            style={[styles.tab, activeTab === "overview" && styles.tabActive]}
            onPress={() => {
              setOpenStageMenu(false);
              setOpenBikeStatusMenuId(null);
              setActiveTab("overview");
            }}
            activeOpacity={0.7}
          >
            <Text style={[styles.tabText, activeTab === "overview" && styles.tabTextActive]}>
              Overview
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tab, activeTab === "invoice" && styles.tabActive]}
            onPress={() => {
              setOpenStageMenu(false);
              setOpenBikeStatusMenuId(null);
              setActiveTab("invoice");
            }}
            activeOpacity={0.7}
          >
            <Text style={[styles.tabText, activeTab === "invoice" && styles.tabTextActive]}>
              Invoice
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tab, activeTab === "notes" && styles.tabActive]}
            onPress={() => {
              setOpenStageMenu(false);
              setOpenBikeStatusMenuId(null);
              setActiveTab("notes");
            }}
            activeOpacity={0.7}
          >
            <Text style={[styles.tabText, activeTab === "notes" && styles.tabTextActive]}>
              Notes
            </Text>
          </TouchableOpacity>
        </View>

        {activeTab === "invoice" ? (
          <InvoiceTab job={job} onJobUpdated={handleInvoiceJobUpdated} />
        ) : activeTab === "notes" ? (
          <>
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
          </>
        ) : (
        <>
        {/* Overview fields */}
        <View style={{ gap: spacing[5] }}>
          {job.customer ? (
            <View style={styles.overviewField}>
              <Text style={styles.overviewLabel}>Customer</Text>
              <View style={styles.overviewCustomerBlock}>
                <Text style={styles.overviewValue}>{customerName(job.customer)}</Text>
                {job.customer.email ? (
                  <TouchableOpacity onPress={() => showEmailAppPicker(job.customer!.email!)}>
                    <Text style={[styles.overviewValue, { color: colors.emerald[500] }]}>
                      {job.customer.email}
                    </Text>
                  </TouchableOpacity>
                ) : null}
                {job.customer.phone ? (
                  <View style={styles.overviewValueRow}>
                    <TouchableOpacity onPress={() => Linking.openURL(`tel:${job.customer!.phone}`)}>
                      <Text style={styles.overviewValue}>
                        {formatPhoneNumber(job.customer.phone)}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => Linking.openURL(`tel:${job.customer!.phone}`)}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Ionicons name="call" size={18} color={colors.emerald[500]} />
                    </TouchableOpacity>
                  </View>
                ) : null}
                {job.customer.address ? (
                  <View style={styles.overviewValueRow}>
                    <TouchableOpacity
                      onPress={openCustomerAddressMaps}
                      style={{ flex: 1 }}
                    >
                      <Text style={[styles.overviewValue, { color: colors.emerald[500] }]}>
                        {job.customer.address}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={openCustomerAddressMaps}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Ionicons name="map-outline" size={18} color={colors.emerald[500]} />
                    </TouchableOpacity>
                  </View>
                ) : null}
              </View>
            </View>
          ) : null}
          <View style={styles.overviewField}>
            <Text style={styles.overviewLabel}>Checked In</Text>
            <Text style={styles.overviewValue}>{formatCheckedIn(checkedInDate)}</Text>
          </View>
          {job.cancellationReason ? (
            <View style={styles.overviewField}>
              <Text style={styles.overviewLabel}>Cancellation Reason</Text>
              <Text style={styles.overviewValue}>{job.cancellationReason}</Text>
            </View>
          ) : null}
        </View>
        {/* Booking Request Banner */}
        {job.stage === "PENDING_APPROVAL" ? (
          <Card
            style={[
              styles.section,
              {
                borderWidth: 1,
                borderColor: theme.dark ? colors.amber[700] : colors.amber[300],
                backgroundColor: theme.dark ? `${colors.amber[800]}66` : colors.amber[50],
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
                    backgroundColor: theme.dark ? colors.red[800] : colors.red[50],
                    borderWidth: 1,
                    borderColor: theme.dark ? colors.red[700] : colors.red[300],
                  },
                  patchJob.isPending && styles.buttonDisabled,
                ]}
              >
                <Ionicons name="close" size={16} color={theme.dark ? colors.red[300] : colors.red[600]} />
                <Text style={{ ...fontSize.sm, fontWeight: "700", color: theme.dark ? colors.red[300] : colors.red[600] }}>
                  Reject
                </Text>
              </TouchableOpacity>
            </View>
          </Card>
        ) : null}

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
          <TouchableOpacity style={styles.row} onPress={() => openDatePicker("dropOff")} activeOpacity={0.6}>
            <Text style={styles.label}>{isCollection ? "Collection pickup" : "Drop-off"}</Text>
            <View style={styles.dateValue}>
              <Text style={[styles.dateText, !job.dropOffDate && { color: theme.textMuted }]}>
                {job.dropOffDate ? formatDate(job.dropOffDate) : "Set date"}
              </Text>
              <Ionicons name="calendar-outline" size={16} color={theme.textMuted} />
            </View>
          </TouchableOpacity>
          {isCollection ? (
            <View style={styles.windowRow}>
              <Text style={[styles.windowLabel, { color: theme.textSecondary }]}>Window</Text>
              <View style={styles.windowInputs}>
                <Input
                  placeholder="From (e.g. 09:00)"
                  value={collPickupFrom}
                  onChangeText={setCollPickupFrom}
                  onBlur={() => {
                    const v = collPickupFrom.trim() || null;
                    if (v !== (job.collectionPickupWindowFrom ?? null))
                      patchJob.mutate({ collectionPickupWindowFrom: v } as Partial<Job>);
                  }}
                  containerStyle={styles.windowInput}
                />
                <Text style={[styles.windowDash, { color: theme.textMuted }]}>–</Text>
                <Input
                  placeholder="To (e.g. 12:00)"
                  value={collPickupTo}
                  onChangeText={setCollPickupTo}
                  onBlur={() => {
                    const v = collPickupTo.trim() || null;
                    if (v !== (job.collectionPickupWindowTo ?? null))
                      patchJob.mutate({ collectionPickupWindowTo: v } as Partial<Job>);
                  }}
                  containerStyle={styles.windowInput}
                />
              </View>
            </View>
          ) : null}
          <TouchableOpacity style={styles.row} onPress={() => openDatePicker("pickup")} activeOpacity={0.6}>
            <Text style={styles.label}>{isCollection ? "Collection return" : "Pickup"}</Text>
            <View style={styles.dateValue}>
              <Text style={[styles.dateText, !job.pickupDate && { color: theme.textMuted }]}>
                {job.pickupDate ? formatDate(job.pickupDate) : "Set date"}
              </Text>
              <Ionicons name="calendar-outline" size={16} color={theme.textMuted} />
            </View>
          </TouchableOpacity>
          {isCollection ? (
            <View style={styles.windowRow}>
              <Text style={[styles.windowLabel, { color: theme.textSecondary }]}>Window</Text>
              <View style={styles.windowInputs}>
                <Input
                  placeholder="From (e.g. 09:00)"
                  value={collReturnFrom}
                  onChangeText={setCollReturnFrom}
                  onBlur={() => {
                    const v = collReturnFrom.trim() || null;
                    if (v !== (job.collectionReturnWindowFrom ?? null))
                      patchJob.mutate({ collectionReturnWindowFrom: v } as Partial<Job>);
                  }}
                  containerStyle={styles.windowInput}
                />
                <Text style={[styles.windowDash, { color: theme.textMuted }]}>–</Text>
                <Input
                  placeholder="To (e.g. 12:00)"
                  value={collReturnTo}
                  onChangeText={setCollReturnTo}
                  onBlur={() => {
                    const v = collReturnTo.trim() || null;
                    if (v !== (job.collectionReturnWindowTo ?? null))
                      patchJob.mutate({ collectionReturnWindowTo: v } as Partial<Job>);
                  }}
                  containerStyle={styles.windowInput}
                />
              </View>
            </View>
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
      </View>
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
              {showDatePicker === "dropOff"
                ? isCollection ? "Collection Pickup Date" : "Drop-off Date"
                : isCollection ? "Collection Return Date" : "Pickup Date"}
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
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          keyboardVerticalOffset={Platform.OS === "ios" ? 64 : 0}
          style={{ flex: 1 }}
        >
          <Pressable
            style={[cancelModalStyles.backdrop, { justifyContent: "flex-end" }]}
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
                scrollEnabled
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
        </KeyboardAvoidingView>
      </Modal>

      {/* Cancel job modal */}
      <Modal
        visible={showCancelModal}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => setShowCancelModal(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          keyboardVerticalOffset={Platform.OS === "ios" ? 64 : 0}
          style={{ flex: 1 }}
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
                  scrollEnabled
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
        </KeyboardAvoidingView>
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
    maxHeight: 180,
    textAlignVertical: "top",
  },
  actions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: spacing[2],
    marginTop: spacing[1],
  },
});
