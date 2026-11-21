import { ScrollView, View, Text, StyleSheet } from "react-native";
import { spacing, fontSize } from "@/lib/theme";
import { useTheme } from "@/lib/ThemeContext";
import { useResponsiveLayout } from "@/hooks/useResponsiveLayout";
import { VoicemailGreetingRecorder } from "@/components/calls/VoicemailGreetingRecorder";

/**
 * Lives under Calls rather than Settings: the greeting is part of how the
 * phone line behaves, and it's the call log people are looking at when they
 * think about what a caller hears.
 */
export default function VoicemailGreetingScreen() {
  const { theme } = useTheme();
  const layout = useResponsiveLayout();

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.background }}
      contentContainerStyle={[
        styles.content,
        layout.isTablet && styles.tabletConstrained,
      ]}
    >
      <View style={styles.intro}>
        <Text style={[styles.introText, { color: theme.textSecondary }]}>
          This plays to callers when nobody answers, just before the beep.
        </Text>
      </View>

      <VoicemailGreetingRecorder />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: spacing[4],
    gap: spacing[4],
    paddingBottom: spacing[12],
  },
  tabletConstrained: {
    width: "100%",
    maxWidth: 760,
    alignSelf: "center",
    padding: spacing[6],
  },
  intro: { gap: spacing[2] },
  introText: { ...fontSize.sm, lineHeight: 20 },
});
