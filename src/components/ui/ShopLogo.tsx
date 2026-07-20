import { useEffect, useState } from "react";
import { Image, StyleSheet, type ImageSourcePropType } from "react-native";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";

const defaultLogo = require("../../../assets/splash-icon.png");

type BrandingResponse = {
  logoUrl?: string | null;
};

function resolveBrandingLogoUrl(logoUrl: string | null | undefined, responseUrl: string): string | null {
  if (!logoUrl || logoUrl === "/bike-ops-logo.png") return null;
  try {
    return new URL(logoUrl, responseUrl).toString();
  } catch {
    return logoUrl;
  }
}

export function ShopLogo() {
  const { role, loading } = useAuth();
  const [source, setSource] = useState<ImageSourcePropType>(defaultLogo);

  useEffect(() => {
    if (loading || !role) return;

    let cancelled = false;
    const apiRole = role === "customer" ? "customer" : "staff";

    api
      .get<BrandingResponse>("/api/settings/branding", { role: apiRole })
      .then(({ data, response }) => {
        const logoUrl = resolveBrandingLogoUrl(data.logoUrl, response.url);
        if (!cancelled) {
          setSource(logoUrl ? { uri: logoUrl } : defaultLogo);
        }
      })
      .catch(() => {
        if (!cancelled) setSource(defaultLogo);
      });

    return () => {
      cancelled = true;
    };
  }, [role, loading]);

  return <Image source={source} style={styles.logo} resizeMode="contain" />;
}

const styles = StyleSheet.create({
  logo: {
    width: 72,
    height: 36,
  },
});
