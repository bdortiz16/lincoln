import { useRouter } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Card, Pill } from "@/components/ui";
import { ASSETS } from "@/data/assets";
import { colors, font, spacing } from "@/theme";
import { formatChange, formatUsd } from "@/utils/format";

export default function Market() {
  const router = useRouter();
  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg }}>
        <Text style={styles.title}>Mercado</Text>
        <Card style={{ padding: 0 }}>
          {ASSETS.map((asset, i) => (
            <Pressable
              key={asset.id}
              style={[styles.row, i > 0 && styles.divider]}
              onPress={() => router.push("/buy")}
            >
              <Text style={styles.icon}>{asset.icon}</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{asset.name}</Text>
                <Text style={styles.symbol}>{asset.symbol}</Text>
              </View>
              <View style={{ alignItems: "flex-end" }}>
                <Text style={styles.price}>{formatUsd(asset.priceLocal)}</Text>
                <Pill
                  label={formatChange(asset.change24h)}
                  tone={asset.change24h >= 0 ? "up" : "down"}
                />
              </View>
            </Pressable>
          ))}
        </Card>
        <Text style={styles.note}>
          Precios de referencia. Conecta una fuente de precios real para producción.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  title: { color: colors.text, fontSize: font.size.xxl, fontWeight: font.weight.bold },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.lg },
  divider: { borderTopWidth: 1, borderTopColor: colors.border },
  icon: { fontSize: 28 },
  name: { color: colors.text, fontSize: font.size.md, fontWeight: font.weight.medium },
  symbol: { color: colors.textMuted, fontSize: font.size.sm },
  price: { color: colors.text, fontSize: font.size.md, fontWeight: font.weight.semibold },
  note: { color: colors.textFaint, fontSize: font.size.xs, textAlign: "center" },
});
