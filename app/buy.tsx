import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Button } from "@/components/ui";
import { Field } from "@/components/Field";
import { useWallet } from "@/context/WalletContext";
import { ASSETS, AssetId, getAsset } from "@/data/assets";
import { colors, font, radius, spacing } from "@/theme";
import { formatAmount, formatUsd } from "@/utils/format";

type Mode = "buy" | "sell";

export default function Buy() {
  const { buy, sell, balanceOf } = useWallet();
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("buy");
  const [assetId, setAssetId] = useState<AssetId>("USDT");
  const [amount, setAmount] = useState("");

  const asset = getAsset(assetId)!;
  const tradable = ASSETS.filter((a) => a.id !== "USD");
  const numeric = parseFloat(amount) || 0;
  const usdBalance = balanceOf("USD");
  const assetBalance = balanceOf(assetId);

  const estimate =
    mode === "buy"
      ? numeric / asset.priceLocal // asset units received per USD spent
      : numeric * asset.priceLocal; // USD received per asset unit sold

  function onConfirm() {
    if (numeric <= 0) return;
    if (mode === "buy") buy(assetId, numeric);
    else sell(assetId, numeric);
    router.back();
  }

  const canConfirm =
    numeric > 0 && (mode === "buy" ? numeric <= usdBalance : numeric <= assetBalance);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.tabs}>
        {(["buy", "sell"] as Mode[]).map((m) => (
          <Pressable
            key={m}
            style={[styles.tab, mode === m && styles.tabActive]}
            onPress={() => {
              setMode(m);
              setAmount("");
            }}
          >
            <Text style={[styles.tabText, mode === m && styles.tabTextActive]}>
              {m === "buy" ? "Comprar" : "Vender"}
            </Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.sectionLabel}>Activo</Text>
      <View style={styles.assetGrid}>
        {tradable.map((a) => (
          <Pressable
            key={a.id}
            style={[styles.assetChip, assetId === a.id && styles.assetChipActive]}
            onPress={() => setAssetId(a.id)}
          >
            <Text style={styles.assetChipIcon}>{a.icon}</Text>
            <Text style={[styles.assetChipText, assetId === a.id && styles.assetChipTextActive]}>
              {a.symbol}
            </Text>
          </Pressable>
        ))}
      </View>

      <Field
        label={mode === "buy" ? "Monto en USD" : `Cantidad de ${asset.symbol}`}
        value={amount}
        onChangeText={setAmount}
        placeholder="0.00"
        keyboardType="decimal-pad"
      />

      <Text style={styles.balanceHint}>
        Disponible:{" "}
        {mode === "buy"
          ? formatUsd(usdBalance)
          : `${formatAmount(assetBalance)} ${asset.symbol}`}
      </Text>

      <View style={styles.summary}>
        <Text style={styles.summaryLabel}>Recibirás aprox.</Text>
        <Text style={styles.summaryValue}>
          {mode === "buy"
            ? `${formatAmount(estimate)} ${asset.symbol}`
            : formatUsd(estimate)}
        </Text>
      </View>

      {!canConfirm && numeric > 0 ? (
        <Text style={styles.error}>Saldo insuficiente.</Text>
      ) : null}

      <Button
        label={mode === "buy" ? "Confirmar compra" : "Confirmar venta"}
        onPress={onConfirm}
        disabled={!canConfirm}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, gap: spacing.md, backgroundColor: colors.bg, flexGrow: 1 },
  tabs: {
    flexDirection: "row",
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: 4,
  },
  tab: { flex: 1, paddingVertical: spacing.md, alignItems: "center", borderRadius: radius.sm },
  tabActive: { backgroundColor: colors.primary },
  tabText: { color: colors.textMuted, fontWeight: font.weight.semibold },
  tabTextActive: { color: colors.black },
  sectionLabel: { color: colors.textMuted, fontSize: font.size.sm, marginTop: spacing.sm },
  assetGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  assetChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  assetChipActive: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  assetChipIcon: { fontSize: 18 },
  assetChipText: { color: colors.textMuted, fontWeight: font.weight.semibold },
  assetChipTextActive: { color: colors.text },
  balanceHint: { color: colors.textMuted, fontSize: font.size.sm },
  summary: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.lg,
  },
  summaryLabel: { color: colors.textMuted, fontSize: font.size.sm },
  summaryValue: { color: colors.text, fontSize: font.size.lg, fontWeight: font.weight.bold },
  error: { color: colors.danger, fontSize: font.size.sm },
});
