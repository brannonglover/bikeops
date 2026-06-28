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
  "com.brannonglover.bikeops.app.subscription.monthly";

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

export async function purchaseSubscription(shopId: string): Promise<void> {
  if (!isIapSupported()) {
    throw new Error("In-app subscriptions are only available on iOS.");
  }
  await ensureIapConnection();
  await requestPurchase({
    request: {
      apple: {
        sku: APPLE_SUBSCRIPTION_PRODUCT_ID,
        appAccountToken: shopId,
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
