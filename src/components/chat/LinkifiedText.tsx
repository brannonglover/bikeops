import { Text, Linking, StyleProp, TextStyle } from "react-native";

const URL_REGEX = /(https?:\/\/[^\s]+)/g;

type Props = {
  text: string;
  style?: StyleProp<TextStyle>;
  linkStyle?: StyleProp<TextStyle>;
};

export function LinkifiedText({ text, style, linkStyle }: Props) {
  const parts = text.split(URL_REGEX);
  return (
    <Text style={style}>
      {parts.map((part, i) =>
        /^https?:\/\//.test(part) ? (
          <Text
            key={i}
            style={[{ textDecorationLine: "underline" }, linkStyle]}
            onPress={() => Linking.openURL(part)}
            suppressHighlighting
          >
            {part}
          </Text>
        ) : (
          <Text key={i}>{part}</Text>
        )
      )}
    </Text>
  );
}
