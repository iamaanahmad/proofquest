import React, { useState } from "react";
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../types";
import { useMWA } from "../hooks/useMWA";
import { useWalletStore } from "../store/wallet";
import { Screen, Icon, useFeedback } from "../ui";
import { color, spacing, radius, typography } from "../theme/tokens";

type Props = NativeStackScreenProps<RootStackParamList, "Welcome">;

export default function WelcomeScreen({ navigation }: Props) {
  const [loading, setLoading] = useState<"requester" | "worker" | null>(null);
  const { connect } = useMWA();
  const { setRole } = useWalletStore();
  const { toast } = useFeedback();

  async function handleConnect(role: "requester" | "worker") {
    setLoading(role);
    try {
      await connect();
      setRole(role);
      navigation.replace("Home");
    } catch (e: any) {
      const msg = e.message ?? "";
      if (!msg.toLowerCase().includes("cancel") && !msg.toLowerCase().includes("reject")) {
        toast({ message: msg || "Connection failed. Try again.", tone: "danger" });
      }
    } finally {
      setLoading(null);
    }
  }

  return (
    <Screen>
      <View style={styles.container}>
        {/* Logo / wordmark */}
        <View style={styles.brandWrap}>
          <View style={styles.mark}>
            <View style={styles.markInner} />
          </View>
          <Text style={styles.wordmark}>ProofQuest</Text>
          <Text style={styles.subtitle}>
            Real-world evidence on Solana.{"\n"}Verified. Trustless. Paid.
          </Text>
        </View>

        {/* Role selection */}
        <View style={styles.roles}>
          <RoleCard
            icon={<Icon name="doc" size={26} color={color.primary} />}
            title="I need proof"
            desc="Post a quest, lock USDC in escrow, approve when satisfied."
            accentColor={color.primary}
            accentBg={color.primarySoft}
            loading={loading === "requester"}
            disabled={!!loading}
            onPress={() => handleConnect("requester")}
          />
          <RoleCard
            icon={<Icon name="pin" size={26} color={color.success} />}
            title="I'll go verify"
            desc="Claim quests near you, capture evidence, earn USDC."
            accentColor={color.success}
            accentBg={color.successSoft}
            loading={loading === "worker"}
            disabled={!!loading}
            onPress={() => handleConnect("worker")}
          />
        </View>

        {/* Footer */}
        <View style={styles.footer}>
          <View style={styles.netBadge}>
            <View style={[styles.netDot, { backgroundColor: color.success }]} />
            <Text style={styles.netText}>Solana Devnet</Text>
          </View>
          <Text style={styles.footerNote}>Powered by MWA · Phantom / Solflare</Text>
        </View>
      </View>
    </Screen>
  );
}

function RoleCard({ icon, title, desc, accentColor, accentBg, loading, disabled, onPress }: any) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={`${title}: ${desc}`}
      style={({ pressed }) => [
        styles.card,
        { borderColor: accentColor + "33" },
        pressed && styles.cardPressed,
        disabled && !loading && styles.cardDisabled,
      ]}
    >
      <View style={[styles.cardIcon, { backgroundColor: accentBg }]}>{icon}</View>
      <View style={styles.cardBody}>
        <Text style={styles.cardTitle}>{title}</Text>
        <Text style={styles.cardDesc}>{desc}</Text>
      </View>
      {loading ? (
        <ActivityIndicator color={accentColor} size="small" />
      ) : (
        <Icon name="chevron-right" size={20} color={accentColor} />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: spacing.xxl, justifyContent: "space-between", paddingVertical: spacing.xxl },

  brandWrap: { alignItems: "center", marginTop: spacing.xxl },
  mark: {
    width: 80, height: 80, borderRadius: 22,
    backgroundColor: color.primarySoft,
    alignItems: "center", justifyContent: "center", marginBottom: spacing.lg,
  },
  markInner: {
    width: 28, height: 28, borderRadius: 14,
    borderWidth: 3, borderColor: color.primary, borderTopColor: color.success,
  },
  wordmark: { ...typography.display, color: color.textPrimary },
  subtitle: { ...typography.body, color: color.textMuted, textAlign: "center", marginTop: spacing.sm, lineHeight: 22 },

  roles: { gap: spacing.md },
  card: {
    flexDirection: "row", alignItems: "center", gap: spacing.lg,
    backgroundColor: color.surface, borderRadius: radius.lg, padding: spacing.lg,
    borderWidth: 1,
  },
  cardPressed: { opacity: 0.85, transform: [{ scale: 0.995 }] },
  cardDisabled: { opacity: 0.4 },
  cardIcon: {
    width: 52, height: 52, borderRadius: radius.md,
    alignItems: "center", justifyContent: "center",
  },
  cardBody: { flex: 1, gap: 3 },
  cardTitle: { ...typography.bodyStrong, color: color.textPrimary },
  cardDesc: { ...typography.caption, color: color.textSecondary, lineHeight: 18 },

  footer: { alignItems: "center", gap: spacing.sm },
  netBadge: {
    flexDirection: "row", alignItems: "center", gap: spacing.xs + 2,
    backgroundColor: color.successSoft, borderRadius: radius.pill,
    paddingHorizontal: spacing.md, paddingVertical: spacing.xs + 1,
  },
  netDot: { width: 6, height: 6, borderRadius: 3 },
  netText: { ...typography.caption, color: color.success, fontWeight: "700" },
  footerNote: { ...typography.caption, color: color.textFaint },
});
