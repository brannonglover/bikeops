import { Text, type TextStyle } from "react-native";

interface PriceProps {
  amount: number | string;
  style?: TextStyle;
}

export function Price({ amount, style }: PriceProps) {
  const num = typeof amount === "string" ? parseFloat(amount) : amount;
  const formatted = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(num);
  return <Text style={style}>{formatted}</Text>;
}
