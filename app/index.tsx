import { useEffect, useState } from "react";
import { Redirect } from "expo-router";
import * as Notifications from "expo-notifications";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { LoadingScreen } from "@/components/ui/LoadingScreen";
import {
  captureBookingDigestFromNotification,
  defaultRouteForRole,
  normalizeNotificationData,
  routeForNotification,
} from "@/lib/notification-routing";
import { prefetchStaffHomeData } from "@/lib/staff-queries";

type LaunchRoute = string | null | "pending";

export default function Index() {
  const { role, loading } = useAuth();
  const queryClient = useQueryClient();
  const [launchRoute, setLaunchRoute] = useState<LaunchRoute>("pending");

  useEffect(() => {
    if (loading) return;

    if (!role) {
      setLaunchRoute("/(auth)/login");
      return;
    }

    if (role === "staff") {
      void prefetchStaffHomeData(queryClient);
    }

    // Route to the role home immediately — don't hold the bike loader open
    // while we inspect the last notification response.
    setLaunchRoute(defaultRouteForRole(role));

    let cancelled = false;
    (async () => {
      const response = await Notifications.getLastNotificationResponseAsync();
      const data = response
        ? normalizeNotificationData(response.notification.request.content.data)
        : null;
      if (captureBookingDigestFromNotification(data)) {
        void Notifications.clearLastNotificationResponseAsync();
      }
      const notificationRoute = data ? routeForNotification(data, role) : null;

      if (!cancelled && notificationRoute) {
        setLaunchRoute(notificationRoute);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [role, loading, queryClient]);

  // Only block on the initial SecureStore auth read — not on network checks.
  if (loading || launchRoute === "pending") {
    return <LoadingScreen message="Starting BikeOps..." />;
  }

  return <Redirect href={launchRoute as never} />;
}
