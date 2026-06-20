import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button, Card } from "@/components/ui";
import { useAuth } from "@/context/AuthContext";
import { colors, font, spacing } from "@/theme";

function MenuItem({ icon, label }: { icon: any; label: string }) {
  return (
    <Pressable style={styles.item}>
      <Ionicons name={icon} size={22} color={colors.textMuted} />
      <Text style={styles.itemLabel}>{label}</Text>
      <Ionicons name="chevron-forward" size={20} color={colors.textFaint} />
    </Pressable>
  );
}

export default function Profile() {
  const { user, signOut } = useAuth();
  const router = useRouter();

  async function onSignOut() {
    await signOut();
    router.replace("/(auth)/welcome");
  }

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg }}>
        <Text style={styles.title}>Perfil</Text>

        <Card style={styles.userCard}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{(user?.name ?? "U").charAt(0).toUpperCase()}</Text>
          </View>
          <View>
            <Text style={styles.name}>{user?.name}</Text>
            <Text style={styles.email}>{user?.email}</Text>
          </View>
        </Card>

        <Card style={{ padding: 0 }}>
          <MenuItem icon="shield-checkmark-outline" label="Verificación de identidad" />
          <MenuItem icon="card-outline" label="Métodos de pago" />
          <MenuItem icon="lock-closed-outline" label="Seguridad" />
          <MenuItem icon="help-circle-outline" label="Ayuda y soporte" />
        </Card>

        <Button label="Cerrar sesión" variant="secondary" onPress={onSignOut} />
        <Text style={styles.version}>Cuy Pay v1.0.0</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  title: { color: colors.text, fontSize: font.size.xxl, fontWeight: font.weight.bold },
  userCard: { flexDirection: "row", alignItems: "center", gap: spacing.lg },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.surfaceAlt,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { color: colors.primary, fontSize: font.size.xl, fontWeight: font.weight.bold },
  name: { color: colors.text, fontSize: font.size.lg, fontWeight: font.weight.semibold },
  email: { color: colors.textMuted, fontSize: font.size.sm },
  item: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  itemLabel: { flex: 1, color: colors.text, fontSize: font.size.md },
  version: { color: colors.textFaint, fontSize: font.size.xs, textAlign: "center" },
});
