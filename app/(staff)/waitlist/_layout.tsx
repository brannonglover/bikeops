import { Stack } from "expo-router";
import { useTheme } from "@/lib/ThemeContext";
import { HamburgerMenu } from "@/components/ui/HamburgerMenu";
import { renderAppHeader } from "@/components/ui/AppHeader";

export default function WaitlistLayout() {
  const { theme } = useTheme();

  return (
    <Stack
      screenOptions={{
        header: renderAppHeader,
        animation: "simple_push",
        customAnimationOnSwipe: true,
        headerTitleStyle: {
          fontWeight: "700",
          color: theme.text,
        },
        headerRight: () => <HamburgerMenu />,
      }}
    >
      <Stack.Screen name="index" options={{ title: "Waitlist" }} />
    </Stack>
  );
}
