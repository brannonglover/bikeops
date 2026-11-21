import React from "react";
import { useNotifications } from "@/hooks/useNotifications";

export function NotificationProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  useNotifications();
  return <>{children}</>;
}
