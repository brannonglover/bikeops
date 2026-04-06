import { useState, useEffect, useMemo, useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  Alert,
  StyleSheet,
  Image,
  TextInput,
  Modal,
  Pressable,
  Linking,
  FlatList,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import { api } from "@/lib/api";
import {
  type Job,
  type JobService,
  type JobProduct,
  type Service,
  type Product,
} from "@/lib/types";
import { colors, spacing, fontSize, borderRadius } from "@/lib/theme";
import { useTheme } from "@/lib/ThemeContext";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { formatCurrency, jobTotal } from "@/lib/format";

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000";

interface InvoiceTabProps {
  job: Job;
  onJobUpdated: (job: Job) => void;
}

export function InvoiceTab({ job, onJobUpdated }: InvoiceTabProps) {
  const { theme } = useTheme();
  const [services, setServices] = useState<
    { id: string; name: string; price: number }[]
  >([]);
  const [products, setProducts] = useState<
    { id: string; name: string; price: number }[]
  >([]);
  const [adding, setAdding] = useState(false);
  const [addingProduct, setAddingProduct] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [removingProduct, setRemovingProduct] = useState<string | null>(null);
  const [updatingQty, setUpdatingQty] = useState<string | null>(null);
  const [updatingPrice, setUpdatingPrice] = useState<string | null>(null);

  const [showServicePicker, setShowServicePicker] = useState(false);
  const [showProductPicker, setShowProductPicker] = useState(false);
  const [serviceSearch, setServiceSearch] = useState("");
  const [productSearch, setProductSearch] = useState("");

  const [editingPriceId, setEditingPriceId] = useState<string | null>(null);
  const [editingPriceValue, setEditingPriceValue] = useState("");
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const toggleExpanded = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const [recordingCash, setRecordingCash] = useState(false);
  const [showCashConfirm, setShowCashConfirm] = useState(false);
  const [resending, setResending] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  useEffect(() => {
    api
      .get<Service[]>("/api/services")
      .then(({ data }) =>
        setServices(
          data.map((s) => ({
            id: s.id,
            name: s.name,
            price:
              typeof s.price === "string" ? parseFloat(s.price) : Number(s.price ?? 0),
          }))
        )
      )
      .catch(() => {});
  }, []);

  useEffect(() => {
    api
      .get<Product[]>("/api/products")
      .then(({ data }) =>
        setProducts(
          data.map((p) => ({
            id: p.id,
            name: p.name,
            price:
              typeof p.price === "string" ? parseFloat(p.price) : Number(p.price ?? 0),
          }))
        )
      )
      .catch(() => {});
  }, []);

  const jobServices: JobService[] = job.jobServices ?? [];
  const jobProductsList: JobProduct[] = job.jobProducts ?? [];

  const attachedServiceIds = useMemo(
    () => new Set(jobServices.map((js) => js.serviceId)),
    [jobServices]
  );
  const attachedProductIds = useMemo(
    () => new Set(jobProductsList.map((jp) => jp.productId)),
    [jobProductsList]
  );

  const availableServices = useMemo(
    () => services.filter((s) => !attachedServiceIds.has(s.id)),
    [services, attachedServiceIds]
  );
  const availableProducts = useMemo(
    () => products.filter((p) => !attachedProductIds.has(p.id)),
    [products, attachedProductIds]
  );

  const filteredServices = useMemo(() => {
    const q = serviceSearch.trim().toLowerCase();
    return q
      ? availableServices.filter((s) => s.name.toLowerCase().includes(q))
      : availableServices;
  }, [availableServices, serviceSearch]);

  const filteredProducts = useMemo(() => {
    const q = productSearch.trim().toLowerCase();
    return q
      ? availableProducts.filter((p) => p.name.toLowerCase().includes(q))
      : availableProducts;
  }, [availableProducts, productSearch]);

  const total = jobTotal(jobServices, jobProductsList);

  const refetchJob = useCallback(async () => {
    const { data } = await api.get<Job>(`/api/jobs/${job.id}`);
    onJobUpdated(data);
  }, [job.id, onJobUpdated]);

  const handleAddService = useCallback(
    async (serviceId: string) => {
      setAdding(true);
      setShowServicePicker(false);
      setServiceSearch("");
      try {
        const res = await api.post(`/api/jobs/${job.id}/services`, { serviceId });
        if (res.response.ok) await refetchJob();
      } finally {
        setAdding(false);
      }
    },
    [job.id, refetchJob]
  );

  const handleAddCustomService = useCallback(
    async (name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      setAdding(true);
      setShowServicePicker(false);
      setServiceSearch("");
      try {
        const res = await api.post(`/api/jobs/${job.id}/services`, {
          customServiceName: trimmed,
          unitPrice: 0,
        });
        if (res.response.ok) await refetchJob();
      } finally {
        setAdding(false);
      }
    },
    [job.id, refetchJob]
  );

  const handleRemoveService = useCallback(
    async (jobServiceId: string) => {
      setRemoving(jobServiceId);
      try {
        const res = await api.delete(
          `/api/jobs/${job.id}/services?jobServiceId=${encodeURIComponent(jobServiceId)}`
        );
        if (res.response.ok) await refetchJob();
      } finally {
        setRemoving(null);
      }
    },
    [job.id, refetchJob]
  );

  const adjustServiceQuantity = useCallback(
    async (jobServiceId: string, quantity: number) => {
      if (quantity < 1) return;
      setUpdatingQty(jobServiceId);
      try {
        const res = await api.patch(`/api/jobs/${job.id}/services`, {
          jobServiceId,
          quantity,
        });
        if (res.response.ok) await refetchJob();
      } finally {
        setUpdatingQty(null);
      }
    },
    [job.id, refetchJob]
  );

  const updateServiceUnitPrice = useCallback(
    async (jobServiceId: string, unitPrice: number) => {
      setUpdatingPrice(jobServiceId);
      try {
        const res = await api.patch(`/api/jobs/${job.id}/services`, {
          jobServiceId,
          unitPrice,
        });
        if (res.response.ok) await refetchJob();
      } finally {
        setUpdatingPrice(null);
      }
    },
    [job.id, refetchJob]
  );

  const handleAddProduct = useCallback(
    async (productId: string) => {
      setAddingProduct(true);
      setShowProductPicker(false);
      setProductSearch("");
      try {
        const res = await api.post(`/api/jobs/${job.id}/products`, { productId });
        if (res.response.ok) await refetchJob();
      } finally {
        setAddingProduct(false);
      }
    },
    [job.id, refetchJob]
  );

  const handleRemoveProduct = useCallback(
    async (jobProductId: string) => {
      setRemovingProduct(jobProductId);
      try {
        const res = await api.delete(
          `/api/jobs/${job.id}/products?jobProductId=${encodeURIComponent(jobProductId)}`
        );
        if (res.response.ok) await refetchJob();
      } finally {
        setRemovingProduct(null);
      }
    },
    [job.id, refetchJob]
  );

  const handleRecordCash = useCallback(async () => {
    setRecordingCash(true);
    try {
      const res = await api.post(`/api/jobs/${job.id}/payments/record-cash`);
      if (res.response.ok) {
        await refetchJob();
        setShowCashConfirm(false);
      } else {
        const errData = res.data as { error?: string };
        Alert.alert("Error", errData?.error ?? "Failed to record cash payment");
      }
    } catch (e) {
      Alert.alert("Error", "Failed to record cash payment");
    } finally {
      setRecordingCash(false);
    }
  }, [job.id, refetchJob]);

  const handleResendReceipt = useCallback(async () => {
    setResending(true);
    try {
      const res = await api.post(`/api/jobs/${job.id}/payments/resend-receipt`);
      if (res.response.ok) {
        Alert.alert("Receipt Sent", "Check inbox and spam folder.");
      } else {
        const errData = res.data as { error?: string };
        Alert.alert("Error", errData?.error ?? "Failed to send receipt");
      }
    } catch {
      Alert.alert("Error", "Failed to send receipt");
    } finally {
      setResending(false);
    }
  }, [job.id]);

  const handlePayOnline = useCallback(() => {
    Linking.openURL(`${API_URL}/pay/${job.id}`);
  }, [job.id]);

  const handleCopyPaymentLink = useCallback(async () => {
    await Clipboard.setStringAsync(`${API_URL}/pay/${job.id}`);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  }, [job.id]);

  const handlePriceBlur = useCallback(
    (jsId: string, currentPrice: number) => {
      setEditingPriceId(null);
      const next = parseFloat(editingPriceValue);
      if (!Number.isFinite(next) || next < 0) return;
      const rounded = Math.round(next * 100) / 100;
      const current = Math.round(currentPrice * 100) / 100;
      if (rounded === current) return;
      updateServiceUnitPrice(jsId, rounded);
    },
    [editingPriceValue, updateServiceUnitPrice]
  );

  const styles = useMemo(
    () =>
      StyleSheet.create({
        bikesSection: {
          gap: spacing[2],
          paddingBottom: spacing[3],
          borderBottomWidth: 1,
          borderBottomColor: theme.surfaceBorder,
          marginBottom: spacing[3],
        },
        bikeChip: {
          flexDirection: "row",
          alignItems: "center",
          gap: spacing[2],
          borderWidth: 1,
          borderColor: theme.surfaceBorder,
          backgroundColor: theme.surface,
          borderRadius: borderRadius.lg,
          paddingHorizontal: spacing[3],
          paddingVertical: spacing[2],
        },
        bikeImage: {
          width: 40,
          height: 40,
          borderRadius: borderRadius.md,
          backgroundColor: theme.placeholderBg,
        },
        bikePlaceholder: {
          width: 40,
          height: 40,
          borderRadius: borderRadius.md,
          backgroundColor: theme.placeholderBg,
          justifyContent: "center",
          alignItems: "center",
        },
        bikeText: {
          ...fontSize.sm,
          fontWeight: "500",
          color: theme.text,
          flex: 1,
        },
        bikeType: {
          ...fontSize.xs,
          color: theme.textSecondary,
        },
        sectionTitle: {
          ...fontSize.sm,
          fontWeight: "700",
          color: theme.textSecondary,
          textTransform: "uppercase",
          letterSpacing: 0.5,
          marginBottom: spacing[2],
        },
        lineItem: {
          borderWidth: 1,
          borderColor: theme.surfaceBorder,
          borderRadius: borderRadius.lg,
          marginBottom: spacing[2],
          overflow: "hidden",
        },
        lineItemHeader: {
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "center",
          paddingVertical: spacing[2],
          paddingHorizontal: spacing[3],
        },
        lineItemLeft: {
          flexDirection: "row",
          alignItems: "center",
          gap: spacing[2],
          flex: 1,
          minWidth: 0,
        },
        chevron: {
          flexShrink: 0,
        },
        typeBadge: {
          paddingHorizontal: spacing[1.5],
          paddingVertical: 2,
          borderRadius: borderRadius.sm,
        },
        typeBadgeService: {
          backgroundColor: colors.purple[50],
        },
        typeBadgeProduct: {
          backgroundColor: colors.blue[50],
        },
        typeBadgeText: {
          fontSize: 10,
          fontWeight: "700",
          textTransform: "uppercase",
          letterSpacing: 0.5,
        },
        typeBadgeServiceText: {
          color: colors.purple[600],
        },
        typeBadgeProductText: {
          color: colors.blue[600],
        },
        lineItemName: {
          ...fontSize.sm,
          fontWeight: "500",
          color: theme.text,
          flex: 1,
        },
        lineItemRight: {
          flexDirection: "row",
          alignItems: "center",
          gap: spacing[2],
        },
        qtyControl: {
          flexDirection: "row",
          alignItems: "center",
          borderWidth: 1,
          borderColor: theme.surfaceBorder,
          borderRadius: borderRadius.md,
          backgroundColor: theme.background,
        },
        qtyButton: {
          paddingHorizontal: spacing[2],
          paddingVertical: spacing[1],
        },
        qtyButtonDisabled: {
          opacity: 0.4,
        },
        qtyButtonText: {
          ...fontSize.sm,
          color: theme.textSecondary,
          fontWeight: "600",
        },
        qtyValue: {
          ...fontSize.sm,
          color: theme.text,
          fontVariant: ["tabular-nums"],
          minWidth: 24,
          textAlign: "center",
        },
        lineItemPrice: {
          ...fontSize.sm,
          fontWeight: "600",
          color: theme.text,
          fontVariant: ["tabular-nums"],
          minWidth: 56,
          textAlign: "right",
        },
        removeButton: {
          padding: spacing[1],
        },
        expandedArea: {
          paddingHorizontal: spacing[3],
          paddingBottom: spacing[3],
          paddingTop: spacing[1],
          borderTopWidth: 1,
          borderTopColor: theme.surfaceBorder,
          backgroundColor: theme.subtleBg,
          gap: spacing[1.5],
        },
        expandedRow: {
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "center",
        },
        expandedLabel: {
          ...fontSize.xs,
          color: theme.textSecondary,
        },
        expandedValue: {
          ...fontSize.xs,
          color: theme.text,
        },
        expandedDescription: {
          ...fontSize.xs,
          color: theme.textSecondary,
          lineHeight: 16,
          marginBottom: spacing[0.5],
        },
        priceInput: {
          ...fontSize.sm,
          color: theme.text,
          borderWidth: 1,
          borderColor: theme.inputBorder,
          backgroundColor: theme.inputBg,
          borderRadius: borderRadius.md,
          paddingHorizontal: spacing[2],
          paddingVertical: spacing[1],
          width: 100,
          textAlign: "right",
          fontVariant: ["tabular-nums"],
        },
        emptyText: {
          ...fontSize.sm,
          color: theme.textSecondary,
          marginBottom: spacing[3],
        },
        addButtons: {
          flexDirection: "row",
          gap: spacing[2],
          paddingTop: spacing[1],
          borderTopWidth: 1,
          borderTopColor: theme.surfaceBorder,
        },
        addButton: {
          flex: 1,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: spacing[1],
          paddingVertical: spacing[2],
          paddingHorizontal: spacing[3],
          borderWidth: 1,
          borderColor: theme.inputBorder,
          borderRadius: borderRadius.lg,
          backgroundColor: theme.surface,
        },
        addButtonText: {
          ...fontSize.sm,
          color: theme.text,
        },
        totalRow: {
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "center",
          paddingTop: spacing[4],
          marginTop: spacing[4],
          borderTopWidth: 2,
          borderTopColor: theme.surfaceBorder,
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
        paidBlock: {
          flexDirection: "row",
          alignItems: "center",
          gap: spacing[2],
          backgroundColor: colors.emerald[50],
          paddingHorizontal: spacing[3],
          paddingVertical: spacing[2],
          borderRadius: borderRadius.lg,
          marginTop: spacing[3],
        },
        paidText: {
          ...fontSize.sm,
          fontWeight: "600",
          color: colors.emerald[700],
        },
        resendRow: {
          flexDirection: "row",
          alignItems: "center",
          gap: spacing[2],
          marginTop: spacing[2],
        },
        resendText: {
          ...fontSize.sm,
          color: theme.textSecondary,
          textDecorationLine: "underline",
        },
        resendHint: {
          ...fontSize.xs,
          color: theme.textMuted,
        },
        noEmailHint: {
          ...fontSize.xs,
          color: colors.amber[600],
          marginTop: spacing[2],
        },
        paymentActions: {
          gap: spacing[2],
          marginTop: spacing[3],
        },
        paymentRow: {
          flexDirection: "row",
          gap: spacing[2],
        },
        payOnlineButton: {
          flex: 1,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: spacing[2],
          backgroundColor: colors.emerald[600],
          paddingVertical: spacing[2.5],
          paddingHorizontal: spacing[3],
          borderRadius: borderRadius.lg,
          minHeight: 44,
        },
        payOnlineText: {
          ...fontSize.sm,
          fontWeight: "600",
          color: colors.white,
        },
        cashButton: {
          flex: 1,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: spacing[2],
          borderWidth: 1,
          borderColor: colors.emerald[300],
          backgroundColor: colors.emerald[50],
          paddingVertical: spacing[2.5],
          paddingHorizontal: spacing[3],
          borderRadius: borderRadius.lg,
          minHeight: 44,
        },
        cashButtonText: {
          ...fontSize.sm,
          fontWeight: "600",
          color: colors.emerald[800],
        },
        copyLinkButton: {
          flexDirection: "row",
          alignItems: "center",
          gap: spacing[2],
          alignSelf: "flex-start",
        },
        copyLinkText: {
          ...fontSize.sm,
          color: theme.textSecondary,
        },
        pickerBackdrop: {
          flex: 1,
          backgroundColor: "rgba(0,0,0,0.5)",
          justifyContent: "flex-end",
        },
        pickerSheet: {
          backgroundColor: theme.surface,
          borderTopLeftRadius: borderRadius["2xl"],
          borderTopRightRadius: borderRadius["2xl"],
          maxHeight: "70%",
          paddingBottom: spacing[8],
        },
        pickerHandle: {
          width: 36,
          height: 4,
          borderRadius: 2,
          backgroundColor: theme.surfaceBorder,
          alignSelf: "center",
          marginTop: spacing[2],
          marginBottom: spacing[2],
        },
        pickerTitle: {
          ...fontSize.base,
          fontWeight: "700",
          color: theme.textHeading,
          paddingHorizontal: spacing[4],
          marginBottom: spacing[2],
        },
        pickerSearch: {
          ...fontSize.sm,
          color: theme.text,
          borderWidth: 1,
          borderColor: theme.inputBorder,
          backgroundColor: theme.inputBg,
          borderRadius: borderRadius.lg,
          paddingHorizontal: spacing[3],
          paddingVertical: spacing[2],
          marginHorizontal: spacing[4],
          marginBottom: spacing[2],
        },
        pickerItem: {
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "center",
          paddingVertical: spacing[3],
          paddingHorizontal: spacing[4],
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: theme.surfaceBorder,
        },
        pickerItemName: {
          ...fontSize.sm,
          fontWeight: "500",
          color: theme.text,
        },
        pickerItemPrice: {
          ...fontSize.xs,
          color: theme.textSecondary,
          fontVariant: ["tabular-nums"],
        },
        customServiceOption: {
          flexDirection: "row",
          alignItems: "center",
          gap: spacing[2],
          paddingVertical: spacing[3],
          paddingHorizontal: spacing[4],
        },
        customServiceText: {
          ...fontSize.sm,
          color: colors.purple[600],
          fontWeight: "500",
        },
        pickerEmpty: {
          ...fontSize.sm,
          color: theme.textMuted,
          paddingVertical: spacing[4],
          paddingHorizontal: spacing[4],
          textAlign: "center",
        },
        cashModalBackdrop: {
          flex: 1,
          backgroundColor: "rgba(0,0,0,0.5)",
          justifyContent: "center",
          alignItems: "center",
          padding: spacing[4],
        },
        cashModalSheet: {
          width: "100%",
          maxWidth: 360,
          backgroundColor: theme.surface,
          borderRadius: borderRadius.xl,
          padding: spacing[5],
          gap: spacing[3],
        },
        cashModalHeader: {
          flexDirection: "row",
          alignItems: "center",
          gap: spacing[3],
        },
        cashModalIcon: {
          width: 40,
          height: 40,
          borderRadius: borderRadius.full,
          backgroundColor: colors.emerald[100],
          justifyContent: "center",
          alignItems: "center",
        },
        cashModalTitle: {
          ...fontSize.lg,
          fontWeight: "700",
          color: theme.textHeading,
        },
        cashModalDesc: {
          ...fontSize.sm,
          color: theme.textSecondary,
        },
        cashModalActions: {
          flexDirection: "row",
          justifyContent: "flex-end",
          gap: spacing[2],
          marginTop: spacing[1],
        },
      }),
    [theme]
  );

  return (
    <View>
      {/* Bikes in this job */}
      <View style={styles.bikesSection}>
        <Text style={styles.sectionTitle}>Bikes in this job</Text>
        {job.jobBikes.map((b) => (
          <View key={b.id} style={styles.bikeChip}>
            {b.imageUrl ? (
              <Image source={{ uri: b.imageUrl }} style={styles.bikeImage} />
            ) : (
              <View style={styles.bikePlaceholder}>
                <Ionicons name="bicycle" size={20} color={theme.iconMuted} />
              </View>
            )}
            <Text style={styles.bikeText} numberOfLines={1}>
              {b.nickname?.trim()
                ? `${b.nickname} (${b.make} ${b.model})`
                : `${b.make} ${b.model}`}
            </Text>
            <Text style={styles.bikeType}>
              {b.bikeType === "E_BIKE" ? "E-bike" : "Standard"}
            </Text>
          </View>
        ))}
      </View>

      {/* Line items */}
      <Text style={styles.sectionTitle}>Line items</Text>

      {jobServices.length === 0 && jobProductsList.length === 0 ? (
        <Text style={styles.emptyText}>
          No services or products on this job yet. Add line items below.
        </Text>
      ) : (
        <View>
          {jobServices.map((js) => {
            const price =
              typeof js.unitPrice === "string"
                ? parseFloat(js.unitPrice)
                : Number(js.unitPrice);
            const qty = js.quantity || 1;
            const lineTotal = price * qty;
            const isSystem = Boolean(js.service?.isSystem);
            const qtyBusy = updatingQty === js.id;
            const isEditingPrice = editingPriceId === js.id;

            const isExpanded = expandedIds.has(js.id);

            return (
              <View key={js.id} style={styles.lineItem}>
                <TouchableOpacity
                  style={styles.lineItemHeader}
                  onPress={() => toggleExpanded(js.id)}
                  activeOpacity={0.7}
                >
                  <View style={styles.lineItemLeft}>
                    <Ionicons
                      name={isExpanded ? "chevron-down" : "chevron-forward"}
                      size={14}
                      color={theme.textMuted}
                      style={styles.chevron}
                    />
                    <View style={[styles.typeBadge, styles.typeBadgeService]}>
                      <Text style={[styles.typeBadgeText, styles.typeBadgeServiceText]}>
                        Service
                      </Text>
                    </View>
                    <Text style={styles.lineItemName} numberOfLines={1}>
                      {js.service?.name ?? "Unknown"}
                      {qty > 1 ? ` × ${qty}` : ""}
                    </Text>
                  </View>
                  <View style={styles.lineItemRight}>
                    {!isSystem && (
                      <View
                        style={styles.qtyControl}
                        onStartShouldSetResponder={() => true}
                      >
                        <TouchableOpacity
                          onPress={() => adjustServiceQuantity(js.id, qty - 1)}
                          disabled={qty <= 1 || qtyBusy}
                          style={[
                            styles.qtyButton,
                            (qty <= 1 || qtyBusy) && styles.qtyButtonDisabled,
                          ]}
                        >
                          <Text style={styles.qtyButtonText}>−</Text>
                        </TouchableOpacity>
                        <Text style={styles.qtyValue}>
                          {qtyBusy ? "…" : qty}
                        </Text>
                        <TouchableOpacity
                          onPress={() => adjustServiceQuantity(js.id, qty + 1)}
                          disabled={qtyBusy}
                          style={[
                            styles.qtyButton,
                            qtyBusy && styles.qtyButtonDisabled,
                          ]}
                        >
                          <Text style={styles.qtyButtonText}>+</Text>
                        </TouchableOpacity>
                      </View>
                    )}
                    <Text style={styles.lineItemPrice}>
                      {formatCurrency(lineTotal)}
                    </Text>
                    <TouchableOpacity
                      onPress={() =>
                        Alert.alert("Remove Service", `Remove "${js.service?.name}"?`, [
                          { text: "Cancel", style: "cancel" },
                          {
                            text: "Remove",
                            style: "destructive",
                            onPress: () => handleRemoveService(js.id),
                          },
                        ])
                      }
                      disabled={removing === js.id}
                      style={styles.removeButton}
                    >
                      <Ionicons
                        name="close-circle"
                        size={18}
                        color={removing === js.id ? theme.textMuted : colors.red[500]}
                      />
                    </TouchableOpacity>
                  </View>
                </TouchableOpacity>
                {isExpanded && (
                  <View style={styles.expandedArea}>
                    {js.service?.description ? (
                      <Text style={styles.expandedDescription}>
                        {js.service.description}
                      </Text>
                    ) : null}
                    <View style={styles.expandedRow}>
                      <Text style={styles.expandedLabel}>Unit price</Text>
                      {isSystem || updatingPrice === js.id ? (
                        <Text style={styles.expandedValue}>
                          {updatingPrice === js.id ? "Saving…" : formatCurrency(price)}
                        </Text>
                      ) : isEditingPrice ? (
                        <TextInput
                          style={styles.priceInput}
                          value={editingPriceValue}
                          onChangeText={setEditingPriceValue}
                          onBlur={() => handlePriceBlur(js.id, price)}
                          keyboardType="decimal-pad"
                          autoFocus
                          selectTextOnFocus
                        />
                      ) : (
                        <TouchableOpacity
                          onPress={() => {
                            setEditingPriceId(js.id);
                            setEditingPriceValue(
                              Number.isFinite(price) ? String(price) : "0"
                            );
                          }}
                        >
                          <Text style={[styles.expandedValue, { textDecorationLine: "underline" }]}>
                            {formatCurrency(price)}
                          </Text>
                        </TouchableOpacity>
                      )}
                    </View>
                    <View style={styles.expandedRow}>
                      <Text style={styles.expandedLabel}>Quantity</Text>
                      <Text style={styles.expandedValue}>{qty}</Text>
                    </View>
                    {js.notes ? (
                      <View style={styles.expandedRow}>
                        <Text style={styles.expandedLabel}>Notes</Text>
                        <Text style={[styles.expandedValue, { flex: 1, textAlign: "right" }]}>
                          {js.notes}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                )}
              </View>
            );
          })}

          {jobProductsList.map((jp) => {
            const price =
              typeof jp.unitPrice === "string"
                ? parseFloat(jp.unitPrice)
                : Number(jp.unitPrice);
            const qty = jp.quantity || 1;
            const lineTotal = price * qty;

            const isExpanded = expandedIds.has(jp.id);

            return (
              <View key={jp.id} style={styles.lineItem}>
                <TouchableOpacity
                  style={styles.lineItemHeader}
                  onPress={() => toggleExpanded(jp.id)}
                  activeOpacity={0.7}
                >
                  <View style={styles.lineItemLeft}>
                    <Ionicons
                      name={isExpanded ? "chevron-down" : "chevron-forward"}
                      size={14}
                      color={theme.textMuted}
                      style={styles.chevron}
                    />
                    <View style={[styles.typeBadge, styles.typeBadgeProduct]}>
                      <Text style={[styles.typeBadgeText, styles.typeBadgeProductText]}>
                        Product
                      </Text>
                    </View>
                    <Text style={styles.lineItemName} numberOfLines={1}>
                      {jp.product?.name ?? "Unknown"}
                      {qty > 1 ? ` × ${qty}` : ""}
                    </Text>
                  </View>
                  <View style={styles.lineItemRight}>
                    <Text style={styles.lineItemPrice}>
                      {formatCurrency(lineTotal)}
                    </Text>
                    <TouchableOpacity
                      onPress={() =>
                        Alert.alert(
                          "Remove Product",
                          `Remove "${jp.product?.name}"?`,
                          [
                            { text: "Cancel", style: "cancel" },
                            {
                              text: "Remove",
                              style: "destructive",
                              onPress: () => handleRemoveProduct(jp.id),
                            },
                          ]
                        )
                      }
                      disabled={removingProduct === jp.id}
                      style={styles.removeButton}
                    >
                      <Ionicons
                        name="close-circle"
                        size={18}
                        color={
                          removingProduct === jp.id ? theme.textMuted : colors.red[500]
                        }
                      />
                    </TouchableOpacity>
                  </View>
                </TouchableOpacity>
                {isExpanded && (
                  <View style={styles.expandedArea}>
                    {jp.product?.description ? (
                      <Text style={styles.expandedDescription}>
                        {jp.product.description}
                      </Text>
                    ) : null}
                    <View style={styles.expandedRow}>
                      <Text style={styles.expandedLabel}>Unit price</Text>
                      <Text style={styles.expandedValue}>{formatCurrency(price)}</Text>
                    </View>
                    <View style={styles.expandedRow}>
                      <Text style={styles.expandedLabel}>Quantity</Text>
                      <Text style={styles.expandedValue}>{qty}</Text>
                    </View>
                    {jp.notes ? (
                      <View style={styles.expandedRow}>
                        <Text style={styles.expandedLabel}>Notes</Text>
                        <Text style={[styles.expandedValue, { flex: 1, textAlign: "right" }]}>
                          {jp.notes}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                )}
              </View>
            );
          })}
        </View>
      )}

      {/* Add buttons */}
      <View style={styles.addButtons}>
        <TouchableOpacity
          style={styles.addButton}
          onPress={() => {
            setServiceSearch("");
            setShowServicePicker(true);
          }}
          disabled={adding}
        >
          <Ionicons name="add" size={16} color={theme.text} />
          <Text style={styles.addButtonText}>
            {adding ? "Adding…" : "Add service"}
          </Text>
        </TouchableOpacity>
        {availableProducts.length > 0 ? (
          <TouchableOpacity
            style={styles.addButton}
            onPress={() => {
              setProductSearch("");
              setShowProductPicker(true);
            }}
            disabled={addingProduct}
          >
            <Ionicons name="add" size={16} color={theme.text} />
            <Text style={styles.addButtonText}>
              {addingProduct ? "Adding…" : "Add product"}
            </Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {/* Total */}
      <View style={styles.totalRow}>
        <Text style={styles.totalLabel}>Total</Text>
        <Text style={styles.totalAmount}>{formatCurrency(total)}</Text>
      </View>

      {/* Payment area */}
      {job.paymentStatus === "PAID" ? (
        <View>
          <View style={styles.paidBlock}>
            <Ionicons
              name="checkmark-circle"
              size={20}
              color={colors.emerald[600]}
            />
            <Text style={styles.paidText}>Paid</Text>
          </View>
          {job.customer?.email?.trim() ? (
            <View style={styles.resendRow}>
              <TouchableOpacity
                onPress={handleResendReceipt}
                disabled={resending}
              >
                <Text style={styles.resendText}>
                  {resending ? "Sending…" : "Resend receipt"}
                </Text>
              </TouchableOpacity>
              <Text style={styles.resendHint}>
                to {job.customer.email}
              </Text>
            </View>
          ) : (
            <Text style={styles.noEmailHint}>
              No customer email on this job. Add a customer with an email to send
              the receipt.
            </Text>
          )}
        </View>
      ) : (
        <View style={styles.paymentActions}>
          <View style={styles.paymentRow}>
            <TouchableOpacity
              style={styles.payOnlineButton}
              onPress={handlePayOnline}
              activeOpacity={0.7}
            >
              <Ionicons name="card" size={16} color={colors.white} />
              <Text style={styles.payOnlineText}>Pay online</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.cashButton}
              onPress={() => setShowCashConfirm(true)}
              activeOpacity={0.7}
            >
              <Ionicons name="cash" size={16} color={colors.emerald[700]} />
              <Text style={styles.cashButtonText}>Record cash</Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity
            style={styles.copyLinkButton}
            onPress={handleCopyPaymentLink}
          >
            <Ionicons
              name={copiedLink ? "checkmark" : "copy-outline"}
              size={16}
              color={
                copiedLink ? colors.emerald[600] : theme.textSecondary
              }
            />
            <Text
              style={[
                styles.copyLinkText,
                copiedLink && { color: colors.emerald[600] },
              ]}
            >
              {copiedLink ? "Copied!" : "Copy payment link"}
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Service picker modal */}
      <Modal
        visible={showServicePicker}
        transparent
        animationType="slide"
        statusBarTranslucent
        onRequestClose={() => setShowServicePicker(false)}
      >
        <Pressable
          style={styles.pickerBackdrop}
          onPress={() => setShowServicePicker(false)}
        >
          <Pressable
            style={styles.pickerSheet}
            onPress={(e) => e.stopPropagation()}
          >
            <View style={styles.pickerHandle} />
            <Text style={styles.pickerTitle}>Add Service</Text>
            <TextInput
              style={styles.pickerSearch}
              placeholder="Search or type a custom service…"
              placeholderTextColor={theme.textMuted}
              value={serviceSearch}
              onChangeText={setServiceSearch}
              autoFocus
            />
            <FlatList
              data={filteredServices}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.pickerItem}
                  onPress={() => handleAddService(item.id)}
                >
                  <Text style={styles.pickerItemName}>{item.name}</Text>
                  <Text style={styles.pickerItemPrice}>
                    {formatCurrency(item.price)}
                  </Text>
                </TouchableOpacity>
              )}
              ListEmptyComponent={
                serviceSearch.trim() ? (
                  <TouchableOpacity
                    style={styles.customServiceOption}
                    onPress={() => handleAddCustomService(serviceSearch)}
                  >
                    <Ionicons
                      name="add-circle"
                      size={18}
                      color={colors.purple[600]}
                    />
                    <Text style={styles.customServiceText}>
                      Add "{serviceSearch.trim()}" as custom service
                    </Text>
                  </TouchableOpacity>
                ) : (
                  <Text style={styles.pickerEmpty}>
                    No available services. Type a name to add a custom one.
                  </Text>
                )
              }
              keyboardShouldPersistTaps="handled"
            />
          </Pressable>
        </Pressable>
      </Modal>

      {/* Product picker modal */}
      <Modal
        visible={showProductPicker}
        transparent
        animationType="slide"
        statusBarTranslucent
        onRequestClose={() => setShowProductPicker(false)}
      >
        <Pressable
          style={styles.pickerBackdrop}
          onPress={() => setShowProductPicker(false)}
        >
          <Pressable
            style={styles.pickerSheet}
            onPress={(e) => e.stopPropagation()}
          >
            <View style={styles.pickerHandle} />
            <Text style={styles.pickerTitle}>Add Product</Text>
            <TextInput
              style={styles.pickerSearch}
              placeholder="Search products…"
              placeholderTextColor={theme.textMuted}
              value={productSearch}
              onChangeText={setProductSearch}
              autoFocus
            />
            <FlatList
              data={filteredProducts}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.pickerItem}
                  onPress={() => handleAddProduct(item.id)}
                >
                  <Text style={styles.pickerItemName}>{item.name}</Text>
                  <Text style={styles.pickerItemPrice}>
                    {formatCurrency(item.price)}
                  </Text>
                </TouchableOpacity>
              )}
              ListEmptyComponent={
                <Text style={styles.pickerEmpty}>No matching products</Text>
              }
              keyboardShouldPersistTaps="handled"
            />
          </Pressable>
        </Pressable>
      </Modal>

      {/* Record cash confirmation modal */}
      <Modal
        visible={showCashConfirm}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => !recordingCash && setShowCashConfirm(false)}
      >
        <Pressable
          style={styles.cashModalBackdrop}
          onPress={() => !recordingCash && setShowCashConfirm(false)}
        >
          <Pressable
            style={styles.cashModalSheet}
            onPress={(e) => e.stopPropagation()}
          >
            <View style={styles.cashModalHeader}>
              <View style={styles.cashModalIcon}>
                <Ionicons name="cash" size={20} color={colors.emerald[600]} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.cashModalTitle}>Record cash payment</Text>
                <Text style={styles.cashModalDesc}>
                  {formatCurrency(total)} will be marked as paid. The job will
                  be completed.
                </Text>
              </View>
            </View>
            <View style={styles.cashModalActions}>
              <Button
                title="Cancel"
                onPress={() => !recordingCash && setShowCashConfirm(false)}
                variant="ghost"
                size="md"
                disabled={recordingCash}
              />
              <Button
                title={
                  recordingCash
                    ? "Recording…"
                    : `Record ${formatCurrency(total)}`
                }
                onPress={handleRecordCash}
                variant="primary"
                size="md"
                loading={recordingCash}
                disabled={recordingCash}
                style={{ backgroundColor: colors.emerald[600] }}
              />
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}
