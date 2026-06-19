import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Card, Pill } from "@/components/ui";
import { useAuth } from "@/context/AuthContext";
import { useWallet } from "@/context/WalletContext";
import { ASSETS } from "@/data/assets";
import { colors, font, radius, spacing } from "@/theme";
import { formatAmount, formatChange, formatUsd } from "@/utils/format";

function QuickAction({ icon, label, onPress }: { icon: any; label: string; onPress: () => void }) {
  return (
    <Pressable style={styles.action} onPress={onPress}>
      <View style={styles.actionIcon}>
        <Ionicons name={icon} size={22} color={colors.primary} />
      </View>
      <Text style={styles.actionLabel}>{label}</Text>
    </Pressable>
  );
}

export default function Home() {
  const { user } = useAuth();
  const { holdings, totalUsd } = useWallet();
  const router = useRouter();

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg }}>
        <View style={styles.header}>
          <View>
            <Text style={styles.greeting}>Hola,</Text>
            <Text style={styles.name}>{user?.name ?? "Usuario"}</Text>
          </View>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{(user?.name ?? "U").charAt(0).toUpperCase()}</Text>
          </View>
        </View>

        <Card style={styles.balanceCard}>
          <Text style={styles.balanceLabel}>Balance total</Text>
          <Text style={styles.balanceValue}>{formatUsd(totalUsd)}</Text>
          <View style={styles.quickRow}>
            <QuickAction icon="add" label="Comprar" onPress={() => router.push("/buy")} />
            <QuickAction icon="arrow-up" label="Enviar" onPress={() => router.push("/send")} />
            <QuickAction icon="arrow-down" label="Recibir" onPress={() => router.push("/receive")} />
          </View>
        </Card>

        <View>
          <Text style={styles.sectionTitle}>Tus activos</Text>
          <Card style={{ padding: 0 }}>
            {holdings.map((h, i) => {
              const asset = ASSETS.find((a) => a.id === h.assetId)!;
              const usd = h.amount * asset.priceLocal;
              return (
                <Pressable
                  key={h.assetId}
                  style={[styles.assetRow, i > 0 && styles.assetDivider]}
                  onPress={() => router.push("/buy")}
                >
                  <Text style={styles.assetIcon}>{asset.icon}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.assetName}>{asset.name}</Text>
                    <Text style={styles.assetSub}>
                      {formatAmount(h.amount)} {asset.symbol}
                    </Text>
                  </View>
                  <View style={{ alignItems: "flex-end" }}>
                    <Text style={styles.assetValue}>{formatUsd(usd)}</Text>
                    <Pill
                      label={formatChange(asset.change24h)}
                      tone={asset.change24h >= 0 ? "up" : "down"}
                    />
                  </View>
                </Pressable>
              );
            })}
          </Card>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  greeting: { color: colors.textMuted, fontSize: font.size.md },
  name: { color: colors.text, fontSize: font.size.xl, fontWeight: font.weight.bold },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.surfaceAlt,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { color: colors.primary, fontSize: font.size.lg, fontWeight: font.weight.bold },
  balanceCard: { gap: spacing.md },
  balanceLabel: { color: colors.textMuted, fontSize: font.size.sm },
  balanceValue: { color: colors.text, fontSize: font.size.display, fontWeight: font.weight.bold },
  quickRow: { flexDirection: "row", justifyContent: "space-between", marginTop: spacing.sm },
  action: { alignItems: "center", gap: spacing.xs, flex: 1 },
  actionIcon: {
    width: 52,
    height: 52,
    borderRadius: radius.md,
    backgroundColor: colors.primarySoft,
    alignItems: "center",
    justifyContent: "center",
  },
  actionLabel: { color: colors.text, fontSize: font.size.sm },
  sectionTitle: {
    color: colors.text,
    fontSize: font.size.lg,
    fontWeight: font.weight.semibold,
    marginBottom: spacing.sm,
  },
  assetRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.lg },
  assetDivider: { borderTopWidth: 1, borderTopColor: colors.border },
  assetIcon: { fontSize: 28 },
  assetName: { color: colors.text, fontSize: font.size.md, fontWeight: font.weight.medium },
  assetSub: { color: colors.textMuted, fontSize: font.size.sm },
  assetValue: { color: colors.text, fontSize: font.size.md, fontWeight: font.weight.semibold },
});
