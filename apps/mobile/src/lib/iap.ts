import { Platform } from "react-native";
import {
  initConnection,
  endConnection,
  fetchProducts,
  requestPurchase,
  finishTransaction,
  purchaseUpdatedListener,
  purchaseErrorListener,
  type Purchase,
  type ProductSubscription,
} from "expo-iap";

export const APPLE_SUBSCRIPTION_PRODUCT_ID =
  process.env.EXPO_PUBLIC_APPLE_SUBSCRIPTION_PRODUCT_ID ??
  "com.gloverlabs.bikeops_monthly";

export function isIapSupported(): boolean {
  return Platform.OS === "ios";
}

let connectionReady = false;

export async function ensureIapConnection(): Promise<void> {
  if (!isIapSupported()) return;
  if (connectionReady) return;
  await initConnection();
  connectionReady = true;
}

export async function disconnectIap(): Promise<void> {
  if (!connectionReady) return;
  await endConnection();
  connectionReady = false;
}

export async function loadSubscriptionProduct(): Promise<ProductSubscription | null> {
  if (!isIapSupported()) return null;
  await ensureIapConnection();
  const products = await fetchProducts({
    skus: [APPLE_SUBSCRIPTION_PRODUCT_ID],
    type: "subs",
  });
  if (!products?.length) return null;
  const match = products.find((p) => p.id === APPLE_SUBSCRIPTION_PRODUCT_ID);
  return (match as ProductSubscription | undefined) ?? null;
}

export function subscribeToPurchaseEvents(handlers: {
  onPurchase: (purchase: Purchase) => void | Promise<void>;
  onError: (error: { code?: string; message?: string }) => void;
}): () => void {
  const purchaseSub = purchaseUpdatedListener((purchase) => {
    void handlers.onPurchase(purchase);
  });
  const errorSub = purchaseErrorListener((error) => {
    handlers.onError({ code: error.code, message: error.message });
  });
  return () => {
    purchaseSub.remove();
    errorSub.remove();
  };
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Apple requires appAccountToken to be an RFC 4122 UUID; omit otherwise. */
function appAccountTokenForShop(shopId: string): string | undefined {
  return UUID_RE.test(shopId) ? shopId : undefined;
}

export async function purchaseSubscription(shopId: string): Promise<void> {
  if (!isIapSupported()) {
    throw new Error("In-app subscriptions are only available on iOS.");
  }
  await ensureIapConnection();
  const appAccountToken = appAccountTokenForShop(shopId);
  await requestPurchase({
    request: {
      apple: {
        sku: APPLE_SUBSCRIPTION_PRODUCT_ID,
        ...(appAccountToken ? { appAccountToken } : {}),
      },
    },
    type: "subs",
  });
}

export async function completePurchase(purchase: Purchase): Promise<void> {
  await finishTransaction({ purchase, isConsumable: false });
}

export function getPurchaseIds(purchase: Purchase): {
  productId: string;
  transactionId: string;
  originalTransactionId?: string;
} {
  const originalTransactionId =
    purchase.store === "apple" && "originalTransactionIdentifierIOS" in purchase
      ? purchase.originalTransactionIdentifierIOS ?? undefined
      : undefined;

  return {
    productId: purchase.productId,
    transactionId: purchase.transactionId ?? purchase.id,
    originalTransactionId,
  };
}
