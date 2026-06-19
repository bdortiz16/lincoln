import { Link } from "expo-router";
import { StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button } from "@/components/ui";
import { colors, font, spacing } from "@/theme";

export default function Welcome() {
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.hero}>
        <View style={styles.logo}>
          <Text style={styles.logoMark}>$</Text>
        </View>
        <Text style={styles.brand}>Lincoln</Text>
        <Text style={styles.tagline}>
          Tus dólares y cripto en un solo lugar.{"\n"}Compra, vende y envía en segundos.
        </Text>
      </View>

      <View style={styles.actions}>
        <Link href="/(auth)/register" asChild>
          <Button label="Crear cuenta" />
        </Link>
        <Link href="/(auth)/login" asChild>
          <Button label="Ya tengo cuenta" variant="secondary" />
        </Link>
        <Text style={styles.legal}>
          Al continuar aceptas los Términos y la Política de Privacidad.
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, padding: spacing.xl, justifyContent: "space-between" },
  hero: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md },
  logo: {
    width: 88,
    height: 88,
    borderRadius: 24,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.sm,
  },
  logoMark: { fontSize: 48, fontWeight: font.weight.bold, color: colors.black },
  brand: { fontSize: font.size.display, fontWeight: font.weight.bold, color: colors.text },
  tagline: {
    fontSize: font.size.md,
    color: colors.textMuted,
    textAlign: "center",
    lineHeight: 24,
  },
  actions: { gap: spacing.md },
  legal: {
    color: colors.textFaint,
    fontSize: font.size.xs,
    textAlign: "center",
    marginTop: spacing.sm,
  },
});
