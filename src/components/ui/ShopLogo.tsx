import { Image, StyleSheet } from "react-native";

const logo = require("../../../assets/bbm-logo-wo.png");

export function ShopLogo() {
  return (
    <Image source={logo} style={styles.logo} resizeMode="contain" />
  );
}

const styles = StyleSheet.create({
  logo: {
    width: 36,
    height: 36,
    borderRadius: 18,
  },
});
