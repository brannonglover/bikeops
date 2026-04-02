import { useState, useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Alert,
  RefreshControl,
  StyleSheet,
  Image,
} from "react-native";
import { useLocalSearchParams, useRouter, Stack } from "expo-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/lib/api";
import { type Job, type Stage, STAGES, STAGE_LABELS, STAGE_COLORS } from "@/lib/types";
import { colors, spacing, fontSize, borderRadius } from "@/lib/theme";
import { Card } from "@/components/ui/Card";
import { StageBadge, PaymentBadge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { LoadingScreen } from "@/components/ui/LoadingScreen";
import {
  customerName,
  jobBikeLabel,
  formatDate,
  formatCurrency,
  jobTotal,
} from "@/lib/format";

export default function JobDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [showStageMenu, setShowStageMenu] = useState(false);

  const {
    data: job,
    isLoading,
    refetch,
    isRefetching,
  } = useQuery({
    queryKey: ["job", id],
    queryFn: async () => {
      const { data } = await api.get<Job>(`/api/jobs/${id}`);
      return data;
    },
    enabled: !!id,
  });

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
      patchJob.mutate({ stage } as Partial<Job>);
      setShowStageMenu(false);
    },
    [patchJob]
  );

  const handleDelete = useCallback(() => {
    Alert.alert("Delete Job", "This action cannot be undone.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => deleteJob.mutate(),
      },
    ]);
  }, [deleteJob]);

  if (isLoading || !job) return <LoadingScreen message="Loading job..." />;

  const total = jobTotal(job.jobServices, job.jobProducts);

  return (
    <>
      <Stack.Screen
        options={{
          title: jobBikeLabel(job),
          headerRight: () => (
            <TouchableOpacity onPress={handleDelete} style={{ padding: spacing[2] }}>
              <Ionicons name="trash-outline" size={20} color={colors.red[500]} />
            </TouchableOpacity>
          ),
        }}
      />
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={refetch} />
        }
      >
        {/* Stage and Status */}
        <Card style={styles.section}>
          <View style={styles.row}>
            <Text style={styles.label}>Status</Text>
            <TouchableOpacity
              onPress={() => setShowStageMenu(!showStageMenu)}
              style={styles.stageSelector}
            >
              <StageBadge stage={job.stage} />
              <Ionicons name="chevron-down" size={14} color={colors.slate[400]} />
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
              <Text style={styles.meta}>{job.customer.email}</Text>
            ) : null}
            {job.customer.phone ? (
              <Text style={styles.meta}>{job.customer.phone}</Text>
            ) : null}
          </Card>
        ) : null}

        {/* Bikes */}
        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>
            {job.jobBikes.length === 1 ? "Bike" : `Bikes (${job.jobBikes.length})`}
          </Text>
          {job.jobBikes.map((jb) => (
            <View key={jb.id} style={styles.bikeRow}>
              {jb.imageUrl ? (
                <Image source={{ uri: jb.imageUrl }} style={styles.bikeImage} />
              ) : (
                <View style={styles.bikePlaceholder}>
                  <Ionicons name="bicycle" size={24} color={colors.slate[300]} />
                </View>
              )}
              <View style={styles.bikeInfo}>
                <Text style={styles.bikeName}>
                  {jb.make} {jb.model}
                </Text>
                {jb.nickname ? (
                  <Text style={styles.bikeNickname}>{jb.nickname}</Text>
                ) : null}
                {jb.bikeType === "E_BIKE" ? (
                  <Text style={styles.eBikeTag}>E-Bike</Text>
                ) : null}
              </View>
            </View>
          ))}
        </Card>

        {/* Dates & Delivery */}
        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>Details</Text>
          <View style={styles.row}>
            <Text style={styles.label}>Delivery</Text>
            <Text style={styles.value}>
              {job.deliveryType === "COLLECTION_SERVICE"
                ? "Collection Service"
                : "Drop-off at Shop"}
            </Text>
          </View>
          {job.dropOffDate ? (
            <View style={styles.row}>
              <Text style={styles.label}>Drop-off</Text>
              <Text style={styles.value}>{formatDate(job.dropOffDate)}</Text>
            </View>
          ) : null}
          {job.pickupDate ? (
            <View style={styles.row}>
              <Text style={styles.label}>Pickup</Text>
              <Text style={styles.value}>{formatDate(job.pickupDate)}</Text>
            </View>
          ) : null}
          {job.collectionAddress ? (
            <View style={styles.row}>
              <Text style={styles.label}>Address</Text>
              <Text style={styles.value}>{job.collectionAddress}</Text>
            </View>
          ) : null}
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
        {job.notes || job.internalNotes || job.customerNotes ? (
          <Card style={styles.section}>
            <Text style={styles.sectionTitle}>Notes</Text>
            {job.notes ? (
              <View style={styles.noteBlock}>
                <Text style={styles.noteLabel}>Notes</Text>
                <Text style={styles.noteText}>{job.notes}</Text>
              </View>
            ) : null}
            {job.internalNotes ? (
              <View style={styles.noteBlock}>
                <Text style={styles.noteLabel}>Internal Notes</Text>
                <Text style={styles.noteText}>{job.internalNotes}</Text>
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

        {/* Actions */}
        <View style={styles.actionsSection}>
          {job.customer ? (
            <Button
              title="Open Chat"
              onPress={() =>
                router.push(
                  `/(staff)/chat/index?customer=${job.customer!.id}` as never
                )
              }
              variant="secondary"
            />
          ) : null}
          <Button
            title="Delete Job"
            onPress={handleDelete}
            variant="danger"
          />
        </View>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.slate[50],
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
    color: colors.slate[800],
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
    color: colors.slate[500],
  },
  value: {
    ...fontSize.sm,
    color: colors.slate[900],
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
    backgroundColor: colors.slate[50],
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
    backgroundColor: colors.white,
  },
  stageDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  stageOptionText: {
    ...fontSize.sm,
    color: colors.slate[600],
  },
  stageOptionTextActive: {
    fontWeight: "600",
    color: colors.slate[900],
  },
  customerNameText: {
    ...fontSize.base,
    fontWeight: "600",
    color: colors.slate[900],
  },
  meta: {
    ...fontSize.sm,
    color: colors.slate[500],
  },
  bikeRow: {
    flexDirection: "row",
    gap: spacing[3],
    alignItems: "center",
  },
  bikeImage: {
    width: 56,
    height: 56,
    borderRadius: borderRadius.lg,
    backgroundColor: colors.slate[100],
  },
  bikePlaceholder: {
    width: 56,
    height: 56,
    borderRadius: borderRadius.lg,
    backgroundColor: colors.slate[100],
    justifyContent: "center",
    alignItems: "center",
  },
  bikeInfo: {
    flex: 1,
    gap: 2,
  },
  bikeName: {
    ...fontSize.sm,
    fontWeight: "600",
    color: colors.slate[900],
  },
  bikeNickname: {
    ...fontSize.xs,
    color: colors.slate[500],
  },
  eBikeTag: {
    ...fontSize.xs,
    color: colors.blue[600],
    fontWeight: "500",
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
    color: colors.slate[900],
    flex: 1,
  },
  lineItemQty: {
    ...fontSize.xs,
    color: colors.slate[500],
  },
  lineItemPrice: {
    ...fontSize.sm,
    fontWeight: "600",
    color: colors.slate[900],
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
    color: colors.slate[900],
  },
  totalAmount: {
    ...fontSize.xl,
    fontWeight: "700",
    color: colors.slate[900],
    fontVariant: ["tabular-nums"],
  },
  noteBlock: {
    gap: spacing[1],
  },
  noteLabel: {
    ...fontSize.xs,
    fontWeight: "600",
    color: colors.slate[500],
    textTransform: "uppercase",
  },
  noteText: {
    ...fontSize.sm,
    color: colors.slate[700],
    lineHeight: 20,
  },
  actionsSection: {
    gap: spacing[3],
    marginTop: spacing[2],
  },
});
