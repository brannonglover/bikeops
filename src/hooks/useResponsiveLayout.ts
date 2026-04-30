import { useMemo } from "react";
import { useWindowDimensions } from "react-native";

export function useResponsiveLayout() {
  const { width, height } = useWindowDimensions();

  return useMemo(() => {
    const shortestSide = Math.min(width, height);
    const isTablet = shortestSide >= 768;
    const isLandscape = width > height;

    return {
      width,
      height,
      isTablet,
      isLandscape,
      contentMaxWidth: isTablet ? 1120 : undefined,
      formMaxWidth: isTablet ? 720 : undefined,
      listMaxWidth: isTablet ? 1040 : undefined,
    };
  }, [width, height]);
}
