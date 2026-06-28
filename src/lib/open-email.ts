import { Alert, Linking, Platform, Share } from "react-native";

function gmailAppUrl(email: string) {
  return `googlegmail://co?to=${encodeURIComponent(email)}`;
}

function gmailWebUrl(email: string) {
  return `https://mail.google.com/mail/?view=cm&to=${encodeURIComponent(email)}`;
}

async function openGmail(email: string) {
  const appUrl = gmailAppUrl(email);
  try {
    if (await Linking.canOpenURL(appUrl)) {
      await Linking.openURL(appUrl);
      return;
    }
  } catch {
    // canOpenURL fails when the scheme is not declared in Info.plist
  }
  await Linking.openURL(gmailWebUrl(email));
}

async function chooseEmailApp(mailto: string) {
  if (Platform.OS === "ios") {
    try {
      await Share.share({ url: mailto });
      return;
    } catch {
      // User dismissed the sheet
      return;
    }
  }
  await Linking.openURL(mailto);
}

export function showEmailAppPicker(email: string) {
  const trimmed = email.trim();
  if (!trimmed) return;

  const mailto = `mailto:${trimmed}`;

  const options: { text: string; style?: "cancel"; onPress?: () => void }[] = [
    { text: "Cancel", style: "cancel" },
  ];

  if (Platform.OS === "ios") {
    options.push({
      text: "Apple Mail",
      onPress: () => void Linking.openURL(mailto),
    });
  } else {
    options.push({
      text: "Email app",
      onPress: () => void Linking.openURL(mailto),
    });
  }

  options.push(
    {
      text: "Gmail",
      onPress: () => void openGmail(trimmed),
    },
    {
      text: "Choose app",
      onPress: () => void chooseEmailApp(mailto),
    }
  );

  Alert.alert("Send email", trimmed, options);
}
