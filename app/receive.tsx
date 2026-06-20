import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, Text, View } from "react-native";
import { Card } from "@/components/ui";
import { useAuth } from "@/context/AuthContext";
import { colors, font, radius, spacing } from "@/theme";

export default function Receive() {
  const { user } = useAuth();
  const handle = (user?.email?.split("@")[0] ?? "usuario") + ".cuypay";
  const address = "0x" + (user?.id ?? "demo").replace(/[^a-z0-9]/gi, "").padEnd(16, "0").slice(0, 16);

  return (
    <View style={styles.container}>
      <Card style={styles.qrCard}>
        <View style={styles.qr}>
          <Ionicons name="qr-code" size={140} color={colors.text} />
        </View>
        <Text style={styles.hint}>Comparte tu usuario o dirección para recibir fondos.</Text>
      </Card>

      <Card style={{ gap: spacing.md }}>
        <View>
          <Text style={styles.label}>Tu usuario Cuy Pay</Text>
          <Text style={styles.value}>{handle}</Text>
        </View>
        <View style={styles.divider} />
        <View>
          <Text style={styles.label}>Dirección de billetera</Text>
          <Text style={styles.value}>{address}</Text>
        </View>
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: spacing.lg, gap: spacing.lg, backgroundColor: colors.bg },
  qrCard: { alignItems: "center", gap: spacing.lg },
  qr: {
    width: 200,
    height: 200,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceAlt,
    alignItems: "center",
    justifyContent: "center",
  },
  hint: { color: colors.textMuted, fontSize: font.size.sm, textAlign: "center" },
  label: { color: colors.textMuted, fontSize: font.size.sm },
  value: { color: colors.text, fontSize: font.size.lg, fontWeight: font.weight.semibold },
  divider: { height: 1, backgroundColor: colors.border },
});
