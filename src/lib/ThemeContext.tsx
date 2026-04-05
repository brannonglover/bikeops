import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import { Appearance, useColorScheme } from "react-native";
import * as SecureStore from "expo-secure-store";
import { colors } from "@/lib/theme";

const THEME_KEY = "app_theme_preference";

export type ThemeMode = "light" | "dark" | "system";

export interface AppTheme {
  dark: boolean;
  background: string;
  surface: string;
  surfaceBorder: string;
  surfaceBorderSubtle: string;
  headerBg: string;
  tabBarBg: string;
  tabBarBorder: string;
  text: string;
  textSecondary: string;
  textTertiary: string;
  textMuted: string;
  textHeading: string;
  icon: string;
  iconMuted: string;
  inputBg: string;
  inputBorder: string;
  inputText: string;
  subtleBg: string;
  placeholderBg: string;
  statusBar: "dark" | "light";
}

const lightTheme: AppTheme = {
  dark: false,
  background: colors.slate[50],
  surface: colors.white,
  surfaceBorder: colors.slate[200],
  surfaceBorderSubtle: colors.slate[100],
  headerBg: colors.white,
  tabBarBg: colors.white,
  tabBarBorder: colors.slate[200],
  text: colors.slate[900],
  textSecondary: colors.slate[500],
  textTertiary: colors.slate[600],
  textMuted: colors.slate[400],
  textHeading: colors.slate[800],
  icon: colors.slate[500],
  iconMuted: colors.slate[300],
  inputBg: colors.white,
  inputBorder: colors.slate[300],
  inputText: colors.slate[900],
  subtleBg: colors.slate[100],
  placeholderBg: colors.slate[100],
  statusBar: "dark",
};

const darkTheme: AppTheme = {
  dark: true,
  background: colors.slate[900],
  surface: colors.slate[800],
  surfaceBorder: colors.slate[700],
  surfaceBorderSubtle: colors.slate[700],
  headerBg: colors.slate[900],
  tabBarBg: colors.slate[900],
  tabBarBorder: colors.slate[700],
  text: colors.slate[50],
  textSecondary: colors.slate[400],
  textTertiary: colors.slate[300],
  textMuted: colors.slate[500],
  textHeading: colors.slate[200],
  icon: colors.slate[400],
  iconMuted: colors.slate[600],
  inputBg: colors.slate[700],
  inputBorder: colors.slate[600],
  inputText: colors.slate[50],
  subtleBg: colors.slate[700],
  placeholderBg: colors.slate[700],
  statusBar: "light",
};

interface ThemeContextValue {
  isDark: boolean;
  themeMode: ThemeMode;
  setThemeMode: (mode: ThemeMode) => void;
  resetTheme: () => void;
  theme: AppTheme;
}

const ThemeContext = createContext<ThemeContextValue>({
  isDark: false,
  themeMode: "light",
  setThemeMode: () => {},
  resetTheme: () => {},
  theme: lightTheme,
});

export function ThemeProvider({ children }: { children: ReactNode }) {
  const systemScheme = useColorScheme();
  const [themeMode, setThemeModeState] = useState<ThemeMode>("light");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    SecureStore.getItemAsync(THEME_KEY).then((value) => {
      if (value === "dark" || value === "system") {
        setThemeModeState(value);
      }
      setLoaded(true);
    });
  }, []);

  const setThemeMode = useCallback((mode: ThemeMode) => {
    setThemeModeState(mode);
    SecureStore.setItemAsync(THEME_KEY, mode);
  }, []);

  const resetTheme = useCallback(() => {
    setThemeModeState("light");
    SecureStore.setItemAsync(THEME_KEY, "light");
  }, []);

  const isDark =
    themeMode === "dark" ||
    (themeMode === "system" && (systemScheme ?? "light") === "dark");

  if (!loaded) return null;

  return (
    <ThemeContext.Provider
      value={{
        isDark,
        themeMode,
        setThemeMode,
        resetTheme,
        theme: isDark ? darkTheme : lightTheme,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
