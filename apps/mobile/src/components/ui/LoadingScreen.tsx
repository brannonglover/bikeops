import { View } from "react-native";
import { useTheme } from "@/lib/ThemeContext";
import { BikeLoader } from "@/components/ui/BikeLoader";

interface LoadingScreenProps {
  message?: string;
}

export function LoadingScreen({ message = "Loading..." }: LoadingScreenProps) {
  const { theme } = useTheme();

  return (
    <View
      style={{
        flex: 1,
        justifyContent: "center",
        alignItems: "center",
        backgroundColor: theme.background,
      }}
    >
      <BikeLoader label={message} />
    </View>
  );
}
