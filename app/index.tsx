import { useEffect } from "react";
import { Redirect } from "expo-router";
import { useAuth } from "@/lib/auth";
import { LoadingScreen } from "@/components/ui/LoadingScreen";

export default function Index() {
  const { role, loading } = useAuth();

  if (loading) {
    return <LoadingScreen message="Starting BikeOps..." />;
  }

  if (role === "staff") {
    return <Redirect href="/(staff)/(jobs)" />;
  }

  if (role === "customer") {
    return <Redirect href="/(customer)/chat" />;
  }

  return <Redirect href="/(auth)/login" />;
}
