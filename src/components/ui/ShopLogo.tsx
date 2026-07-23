import { useEffect, useState } from "react";
import { Image, type ImageSourcePropType } from "react-native";
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

const LOGO_SIZES = {
  md: { width: 96, height: 48 },
  /** Tall draw size; negative margin keeps the header chrome tight. */
  lg: { width: 176, height: 88, marginVertical: -14 },
} as const;

export function ShopLogo({
  useShopBranding = true,
  size = "md",
}: {
  /** When false, always show the Bike Ops logo (e.g. customer home). */
  useShopBranding?: boolean;
  size?: keyof typeof LOGO_SIZES;
}) {
  const { role, loading } = useAuth();
  const [source, setSource] = useState<ImageSourcePropType>(defaultLogo);

  useEffect(() => {
    if (!useShopBranding || loading || !role) {
      setSource(defaultLogo);
      return;
    }

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
  }, [role, loading, useShopBranding]);

  return (
    <Image
      source={source}
      style={LOGO_SIZES[size]}
      resizeMode="contain"
      accessibilityLabel="Bike Ops"
    />
  );
}
