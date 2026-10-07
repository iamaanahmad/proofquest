import React, { useEffect, useState } from "react";
import {
  View, Text, ScrollView, StyleSheet, ActivityIndicator,
} from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList, Quest } from "../types";
import { useWalletStore } from "../store/wallet";
import { getQuest, updateQuest } from "../lib/appwrite";
import { buildClaimTx, buildApproveTx, buildCancelTx, buildRefundTx } from "../lib/transactions";
import { signAndBroadcast } from "../hooks/useMWA";
import { PublicKey } from "@solana/web3.js";
import {
  Screen, ScreenHeader, Card, StatusBadge, Button, Icon, useFeedback,
} from "../ui";
import { color, spacing, radius, typography } from "../theme/tokens";

type Props = NativeStackScreenProps<RootStackParamList, "QuestDetail">;

export default function QuestDetailScreen({ route, navigation }: Props) {
  const { questPublicKey } = route.params;
  const { role, publicKey } = useWalletStore();
  const { alert, confirm, toast } = useFeedback();
  const [quest, setQuest] = useState<Quest | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    getQuest(questPublicKey)
      .then((d) => setQuest(d as unknown as Quest))
      .catch(() => setLoadError(true));
  }, [questPublicKey]);

  /* ── actions (logic unchanged) ── */

  async function handleClaim() {
    if (!quest || !publicKey) return;
    setLoading(true);
    try {
      const tx = await buildClaimTx(new PublicKey(quest.creator), BigInt(quest.questId), publicKey);
      await signAndBroadcast(tx);
      await updateQuest(questPublicKey, { status: "claimed", worker: publicKey.toBase58() });
      navigation.navigate("Capture", { questPublicKey });
    } catch (e: any) {
      const msg = e.message ?? "";
      if (!msg.toLowerCase().includes("cancel") && !msg.toLowerCase().includes("reject")) {
        await alert({ title: "Claim failed", message: msg, tone: "danger" });
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleApprove() {
    if (!quest || !publicKey) return;
    setLoading(true);
    try {
      const tx = await buildApproveTx(
        new PublicKey(quest.creator), BigInt(quest.questId), new PublicKey(quest.worker!)
      );
      await signAndBroadcast(tx);
      await updateQuest(questPublicKey, { status: "approved" });
      await alert({ title: "Approved", message: "USDC released to the worker.", tone: "success", confirmLabel: "Done" });
      navigation.goBack();
    } catch (e: any) {
      await alert({ title: "Approve failed", message: e.message, tone: "danger" });
    } finally {
      setLoading(false);
    }
  }

  async function handleCancel() {
    if (!quest || !publicKey) return;
    const ok = await confirm({
      title: "Cancel this quest?",
      message: "This closes the quest and returns the escrowed USDC to your wallet. This can't be undone.",
      confirmLabel: "Cancel & refund",
      cancelLabel: "Keep quest",
      tone: "danger",
      destructive: true,
    });
    if (!ok) return;
    setLoading(true);
    try {
      const tx = await buildCancelTx(new PublicKey(quest.creator), BigInt(quest.questId));
      await signAndBroadcast(tx);
      await updateQuest(questPublicKey, { status: "cancelled" });
      await alert({ title: "Quest cancelled", message: "Your USDC has been returned.", tone: "success", confirmLabel: "Done" });
      navigation.goBack();
    } catch (e: any) {
      const msg = e?.message ?? "";
      if (!msg.toLowerCase().includes("cancel") && !msg.toLowerCase().includes("reject")) {
        await alert({ title: "Cancel failed", message: msg, tone: "danger" });
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleRefund() {
    if (!quest || !publicKey) return;
    setLoading(true);
    try {
      const tx = await buildRefundTx(new PublicKey(quest.creator), BigInt(quest.questId));
      await signAndBroadcast(tx);
      await updateQuest(questPublicKey, { status: "refunded" });
      await alert({ title: "Refunded", message: "The quest expired. Your USDC has been returned.", tone: "success", confirmLabel: "Done" });
      navigation.goBack();
    } catch (e: any) {
      const msg = e?.message ?? "";
      if (!msg.toLowerCase().includes("cancel") && !msg.toLowerCase().includes("reject")) {
        await alert({ title: "Refund failed", message: msg, tone: "danger" });
      }
    } finally {
      setLoading(false);
    }
  }

  /* ── states ── */

  if (loadError) {
    return (
      <Screen>
        <ScreenHeader onBack={() => navigation.goBack()} />
        <View style={styles.center}>
          <Icon name="alert" size={40} color={color.danger} />
          <Text style={styles.errorMsg}>Failed to load quest</Text>
          <Button label="Go back" variant="secondary" onPress={() => navigation.goBack()} />
        </View>
      </Screen>
    );
  }

  if (!quest) {
    return (
      <Screen>
        <ScreenHeader onBack={() => navigation.goBack()} />
        <View style={styles.center}>
          <ActivityIndicator color={color.primary} size="large" />
          <Text style={styles.loadingText}>Loading quest…</Text>
        </View>
      </Screen>
    );
  }

  const isWorker = role === "worker";
  const isCreator = role === "requester" && publicKey?.toBase58() === quest.creator;

  // Eligibility (mirrors on-chain program exactly)
  const nowSec = Math.floor(Date.now() / 1000);
  const SUBMIT_GRACE = 7 * 24 * 3600;
  const canCancel = isCreator && quest.status === "open";
  const canRefund =
    isCreator &&
    ((quest.status === "claimed" && !!quest.submitDeadline && nowSec > quest.submitDeadline) ||
      (quest.status === "submitted" && !!quest.submitDeadline && nowSec > quest.submitDeadline + SUBMIT_GRACE));

  return (
    <Screen>
      <ScreenHeader
        title="Quest"
        onBack={() => navigation.goBack()}
        right={<StatusBadge status={quest.status} />}
      />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>{quest.title ?? "Quest"}</Text>

        {/* Reward */}
        <View style={styles.rewardChip}>
          <Icon name="coin" size={22} color={color.success} />
          <Text style={styles.rewardAmount}>{(quest.rewardAmount / 1_000_000).toFixed(2)}</Text>
          <Text style={styles.rewardUnit}>USDC</Text>
        </View>

        {quest.description ? <Text style={styles.desc}>{quest.description}</Text> : null}

        {/* Stats */}
        <Card padded={false} style={styles.statsCard}>
          <Stat icon="clock" label="Claim by" value={fmtTime(quest.claimDeadline)} />
          <View style={styles.divider} />
          <Stat icon="clock" label="Submit by" value={fmtTime(quest.submitDeadline)} />
          <View style={styles.divider} />
          <Stat icon="wallet" label="Creator" value={shortAddr(quest.creator)} mono />
          {quest.worker ? (
            <>
              <View style={styles.divider} />
              <Stat icon="wallet" label="Worker" value={shortAddr(quest.worker)} mono />
            </>
          ) : null}
        </Card>

        {/* Schema */}
        <Card style={styles.schemaCard}>
          <View style={styles.schemaRow}>
            <Icon name="shield-check" size={18} color={color.primary} />
            <Text style={styles.schemaLabel}>Evidence schema</Text>
          </View>
          <Text style={styles.schemaHash}>{quest.evidenceSchemaHash?.slice(0, 24)}…</Text>
        </Card>

        {/* Actions — same eligibility, now with styled feedback */}
        {isWorker && quest.status === "open" && (
          <Button label="Claim quest" variant="success" loading={loading} onPress={handleClaim} />
        )}

        {isWorker && quest.status === "claimed" && quest.worker === publicKey?.toBase58() && (
          <Button
            label="Capture evidence"
            variant="primary"
            onPress={() => navigation.navigate("Capture", { questPublicKey })}
          />
        )}

        {isCreator && quest.status === "submitted" && (
          <View style={styles.actionGroup}>
            <Button
              label="Review proof"
              variant="secondary"
              onPress={() => navigation.navigate("Review", { questPublicKey })}
            />
            <Button label="Approve & release USDC" variant="success" loading={loading} onPress={handleApprove} />
          </View>
        )}

        {canRefund && (
          <Button label="Refund expired quest" variant="destructive" loading={loading} onPress={handleRefund} />
        )}

        {canCancel && (
          <Button label="Cancel quest & refund" variant="destructive" loading={loading} onPress={handleCancel} style={{ marginTop: spacing.sm }} />
        )}
      </ScrollView>
    </Screen>
  );
}

function Stat({ icon, label, value, mono }: { icon: any; label: string; value: string; mono?: boolean }) {
  return (
    <View style={styles.stat}>
      <Icon name={icon} size={16} color={color.textMuted} />
      <View style={styles.statText}>
        <Text style={styles.statLabel}>{label}</Text>
        <Text style={[styles.statValue, mono && styles.mono]} numberOfLines={1}>{value}</Text>
      </View>
    </View>
  );
}

const fmtTime = (ts: number) =>
  ts ? new Date(ts * 1000).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";

const shortAddr = (addr: string) => addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : "—";

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md },
  errorMsg: { ...typography.body, color: color.danger },
  loadingText: { ...typography.caption, color: color.textMuted, marginTop: spacing.sm },

  content: { padding: spacing.xl, paddingBottom: spacing.huge, gap: spacing.lg },
  title: { ...typography.display, color: color.textPrimary, fontSize: 26 },

  rewardChip: {
    flexDirection: "row", alignItems: "center", gap: spacing.xs + 2,
    backgroundColor: color.successSoft, borderRadius: radius.md,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    alignSelf: "flex-start",
  },
  rewardAmount: { ...typography.title, color: color.success, fontWeight: "800", lineHeight: 28 },
  rewardUnit: { ...typography.label, color: color.success, lineHeight: 28 },

  desc: { ...typography.body, color: color.textSecondary, lineHeight: 22 },

  statsCard: { padding: 0, overflow: "hidden" },
  stat: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.lg },
  statText: { flex: 1 },
  statLabel: { ...typography.caption, color: color.textMuted },
  statValue: { ...typography.bodyStrong, color: color.textPrimary, marginTop: 1 },
  mono: { fontFamily: "monospace", fontSize: 12, color: color.textSecondary },
  divider: { height: 1, backgroundColor: color.border, marginHorizontal: spacing.lg },

  schemaCard: { gap: spacing.sm },
  schemaRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  schemaLabel: { ...typography.overline, color: color.primary },
  schemaHash: { ...typography.mono, color: color.textMuted },

  actionGroup: { gap: spacing.sm },
});
