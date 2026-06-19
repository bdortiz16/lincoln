import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Button } from "@/components/ui";
import { Field } from "@/components/Field";
import { useWallet } from "@/context/WalletContext";
import { ASSETS, AssetId, getAsset } from "@/data/assets";
import { colors, font, radius, spacing } from "@/theme";
import { formatAmount } from "@/utils/format";

export default function Send() {
  const { send, balanceOf } = useWallet();
  const router = useRouter();
  const [assetId, setAssetId] = useState<AssetId>("USDT");
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");

  const asset = getAsset(assetId)!;
  const numeric = parseFloat(amount) || 0;
  const balance = balanceOf(assetId);
  const canSend = numeric > 0 && numeric <= balance && to.trim().length > 0;

  function onSend() {
    if (!canSend) return;
    send(assetId, numeric, to.trim());
    router.back();
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.sectionLabel}>Activo a enviar</Text>
      <View style={styles.assetGrid}>
        {ASSETS.map((a) => (
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
        label="Para (usuario, email o dirección)"
        value={to}
        onChangeText={setTo}
        placeholder="maria.lemon / 0x… / maria@email.com"
        autoCapitalize="none"
      />

      <Field
        label={`Cantidad (${asset.symbol})`}
        value={amount}
        onChangeText={setAmount}
        placeholder="0.00"
        keyboardType="decimal-pad"
      />

      <Text style={styles.balanceHint}>
        Disponible: {formatAmount(balance)} {asset.symbol}
      </Text>

      {numeric > balance ? <Text style={styles.error}>Saldo insuficiente.</Text> : null}

      <Button label="Enviar" onPress={onSend} disabled={!canSend} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, gap: spacing.md, backgroundColor: colors.bg, flexGrow: 1 },
  sectionLabel: { color: colors.textMuted, fontSize: font.size.sm },
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
  error: { color: colors.danger, fontSize: font.size.sm },
});
