import { useEffect, useState } from "react";
import { Redirect } from "expo-router";
import * as Notifications from "expo-notifications";
import { useAuth } from "@/lib/auth";
import { LoadingScreen } from "@/components/ui/LoadingScreen";
import {
  defaultRouteForRole,
  normalizeNotificationData,
  routeForNotification,
} from "@/lib/notification-routing";

type LaunchRoute = string | null | "pending";

export default function Index() {
  const { role, loading } = useAuth();
  const [launchRoute, setLaunchRoute] = useState<LaunchRoute>("pending");

  useEffect(() => {
    if (loading) return;

    if (!role) {
      setLaunchRoute("/(auth)/login");
      return;
    }

    let cancelled = false;

    (async () => {
      const response = await Notifications.getLastNotificationResponseAsync();
      const data = response
        ? normalizeNotificationData(response.notification.request.content.data)
        : null;
      const notificationRoute = data ? routeForNotification(data, role) : null;

      if (!cancelled) {
        setLaunchRoute(notificationRoute ?? defaultRouteForRole(role));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [role, loading]);

  if (loading || launchRoute === "pending") {
    return <LoadingScreen message="Starting BikeOps..." />;
  }

  return <Redirect href={launchRoute as never} />;
}
