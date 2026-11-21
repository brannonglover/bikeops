import * as SecureStore from "expo-secure-store";
import type { Href } from "expo-router";

const LOGIN_RETURN_KEY = "customer_login_return_path";

/** Remember where to send the customer after a magic-link verify. */
export async function setCustomerLoginReturnPath(
  path: string
): Promise<void> {
  await SecureStore.setItemAsync(LOGIN_RETURN_KEY, path);
}

export async function consumeCustomerLoginReturnPath(): Promise<Href | null> {
  try {
    const path = await SecureStore.getItemAsync(LOGIN_RETURN_KEY);
    if (path) await SecureStore.deleteItemAsync(LOGIN_RETURN_KEY);
    if (
      path === "/(customer)/" ||
      path === "/(customer)/profile" ||
      path === "/(customer)/chat" ||
      path === "/(customer)/repairs" ||
      path === "/(customer)/book"
    ) {
      return path;
    }
    return null;
  } catch {
    return null;
  }
}
