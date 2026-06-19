import { Ionicons } from "@expo/vector-icons";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Card } from "@/components/ui";
import { useWallet, Transaction } from "@/context/WalletContext";
import { getAsset } from "@/data/assets";
import { colors, font, spacing } from "@/theme";
import { formatAmount, formatDate, formatUsd } from "@/utils/format";

const META: Record<Transaction["type"], { icon: any; label: string; sign: string; color: string }> = {
  buy: { icon: "add-circle", label: "Compra", sign: "+", color: colors.primary },
  sell: { icon: "remove-circle", label: "Venta", sign: "-", color: colors.warning },
  send: { icon: "arrow-up-circle", label: "Envío", sign: "-", color: colors.danger },
  receive: { icon: "arrow-down-circle", label: "Recibido", sign: "+", color: colors.primary },
};

export default function Activity() {
  const { transactions } = useWallet();

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg }}>
        <Text style={styles.title}>Actividad</Text>

        {transactions.length === 0 ? (
          <Card>
            <Text style={styles.empty}>Aún no tienes movimientos.</Text>
          </Card>
        ) : (
          <Card style={{ padding: 0 }}>
            {transactions.map((tx, i) => {
              const asset = getAsset(tx.assetId);
              const meta = META[tx.type];
              return (
                <View key={tx.id} style={[styles.row, i > 0 && styles.divider]}>
                  <Ionicons name={meta.icon} size={32} color={meta.color} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.label}>
                      {meta.label} · {asset?.symbol}
                    </Text>
                    <Text style={styles.sub}>
                      {tx.counterparty ? `${tx.counterparty} · ` : ""}
                      {formatDate(tx.date)}
                    </Text>
                  </View>
                  <View style={{ alignItems: "flex-end" }}>
                    <Text style={[styles.amount, { color: meta.color }]}>
                      {meta.sign}
                      {formatAmount(tx.amount)} {asset?.symbol}
                    </Text>
                    <Text style={styles.usd}>{formatUsd(tx.usdValue)}</Text>
                  </View>
                </View>
              );
            })}
          </Card>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  title: { color: colors.text, fontSize: font.size.xxl, fontWeight: font.weight.bold },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.lg },
  divider: { borderTopWidth: 1, borderTopColor: colors.border },
  label: { color: colors.text, fontSize: font.size.md, fontWeight: font.weight.medium },
  sub: { color: colors.textMuted, fontSize: font.size.sm },
  amount: { fontSize: font.size.md, fontWeight: font.weight.semibold },
  usd: { color: colors.textMuted, fontSize: font.size.sm },
  empty: { color: colors.textMuted, textAlign: "center" },
});
