import React, { useEffect, useState, useCallback } from "react";
import {
  View, Text, FlatList, Pressable, StyleSheet,
  RefreshControl, PermissionsAndroid, Linking,
} from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList, Quest } from "../types";
import { useWalletStore } from "../store/wallet";
import { listNearbyQuests, listMyQuests, listMyWorkQuests, clearAppwriteSession } from "../lib/appwrite";
import { useMWA } from "../hooks/useMWA";
import { Screen, Card, StatusBadge, Icon, useFeedback } from "../ui";
import { color, spacing, radius, typography } from "../theme/tokens";
import Geolocation from "react-native-geolocation-service";
import Geohash from "ngeohash";

type Props = NativeStackScreenProps<RootStackParamList, "Home">;

async function requestLocation(): Promise<GeolocationPosition> {
  const granted = await PermissionsAndroid.request(
    PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
    {
      title: "Location permission",
      message: "ProofQuest uses your location to find quests near you.",
      buttonPositive: "Allow",
      buttonNegative: "Deny",
    }
  );
  if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
    throw new Error("Location permission denied");
  }
  return new Promise<GeolocationPosition>((res, rej) =>
    Geolocation.getCurrentPosition(res, rej, { enableHighAccuracy: false, timeout: 10000 })
  );
}

export default function HomeScreen({ navigation }: Props) {
  const { role, publicKey, clear, hydrated } = useWalletStore();
  const { disconnect } = useMWA();
  const { confirm, toast } = useFeedback();

  const [quests, setQuests] = useState<Quest[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [needsLocation, setNeedsLocation] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    setNeedsLocation(false);
    try {
      if (role === "worker") {
        if (!publicKey) throw new Error("Wallet not connected");
        const pos = await requestLocation();
        const gh = Geohash.encode(pos.coords.latitude, pos.coords.longitude, 4);
        const [nearby, mine] = await Promise.all([
          listNearbyQuests(gh.slice(0, 3)),
          listMyWorkQuests(publicKey.toBase58()),
        ]);
        const byKey = new Map<string, Quest>();
        for (const q of mine.documents as unknown as Quest[]) byKey.set(q.publicKey, q);
        for (const q of nearby.documents as unknown as Quest[]) {
          if (!byKey.has(q.publicKey)) byKey.set(q.publicKey, q);
        }
        setQuests(Array.from(byKey.values()));
      } else {
        if (!publicKey) throw new Error("Wallet not connected");
        const result = await listMyQuests(publicKey.toBase58());
        setQuests(result.documents as unknown as Quest[]);
      }
    } catch (e: any) {
      const msg = e?.message ?? "Failed to load quests";
      if (msg === "Location permission denied") {
        setNeedsLocation(true);
      } else {
        setError(msg);
      }
    } finally {
      setRefreshing(false);
      setLoading(false);
    }
  }, [role, publicKey]);

  useEffect(() => { if (hydrated) load(); }, [load, hydrated]);

  async function handleDisconnect() {
    const ok = await confirm({
      title: "Disconnect wallet?",
      message: "You'll return to the start screen and can reconnect with any wallet.",
      confirmLabel: "Disconnect",
      cancelLabel: "Stay",
    });
    if (!ok) return;
    try { await disconnect(); } catch {}
    try { await clearAppwriteSession(); } catch {}
    clear();
    navigation.replace("Welcome");
  }

  const addr = publicKey?.toBase58() ?? "";
  const shortAddr = addr ? `${addr.slice(0, 4)}…${addr.slice(-4)}` : "—";
  const isWorker = role === "worker";

  return (
    <Screen>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={styles.heading}>{isWorker ? "Nearby quests" : "My quests"}</Text>
          <View style={styles.walletChip}>
            <View style={styles.walletDot} />
            <Text style={styles.walletAddr}>{shortAddr}</Text>
            <Text style={styles.roleTag}>· {isWorker ? "Worker" : "Requester"}</Text>
          </View>
        </View>

        <View style={styles.headerActions}>
          {role === "requester" && (
            <Pressable
              onPress={() => navigation.navigate("CreateQuest")}
              accessibilityRole="button"
              accessibilityLabel="Create a new quest"
              style={({ pressed }) => [styles.newBtn, pressed && styles.pressed]}
            >
              <Icon name="plus" size={16} color={color.onAccent} strokeWidth={2.5} />
              <Text style={styles.newBtnText}>Quest</Text>
            </Pressable>
          )}
          <Pressable
            onPress={handleDisconnect}
            accessibilityRole="button"
            accessibilityLabel="Disconnect wallet"
            hitSlop={8}
            style={({ pressed }) => [styles.iconBtn, pressed && styles.pressed]}
          >
            <Icon name="power" size={18} color={color.textSecondary} />
          </Pressable>
        </View>
      </View>

      {/* Error banner */}
      {error && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText} numberOfLines={2}>{error}</Text>
          <Pressable onPress={load} accessibilityRole="button" accessibilityLabel="Retry">
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      )}

      <FlatList
        data={quests}
        keyExtractor={(q) => q.publicKey}
        contentContainerStyle={quests.length === 0 ? styles.listEmpty : styles.list}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={load} tintColor={color.primary} />
        }
        renderItem={({ item }) => <QuestRow item={item} onPress={() =>
          navigation.navigate("QuestDetail", { questPublicKey: item.publicKey })} />}
        ListEmptyComponent={
          loading ? null : (
            <EmptyState
              isWorker={isWorker}
              needsLocation={needsLocation}
              onEnableLocation={() => Linking.openSettings()}
              onCreate={() => navigation.navigate("CreateQuest")}
            />
          )
        }
      />
    </Screen>
  );
}

function QuestRow({ item, onPress }: { item: Quest; onPress: () => void }) {
  const reward = typeof item.rewardAmount === "number" ? (item.rewardAmount / 1_000_000).toFixed(2) : "—";
  const area = (item.areaLabel ?? item.coarseGeohash ?? "").toUpperCase();
  const deadline = item.claimDeadline
    ? new Date(item.claimDeadline * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : null;

  return (
    <Card onPress={onPress} accessibilityLabel={`${item.title ?? "Quest"}, ${reward} USDC, status ${item.status}`} style={styles.card}>
      <View style={styles.cardTop}>
        <Text style={styles.cardTitle} numberOfLines={1}>{item.title ?? "Quest"}</Text>
        <StatusBadge status={item.status} />
      </View>

      <View style={styles.rewardRow}>
        <Text style={styles.rewardAmount}>{reward}</Text>
        <Text style={styles.rewardUnit}>USDC</Text>
      </View>

      <View style={styles.metaRow}>
        {area ? (
          <View style={styles.metaItem}>
            <Icon name="pin" size={13} color={color.primary} />
            <Text style={styles.metaText}>{area}</Text>
          </View>
        ) : <View />}
        {deadline ? <Text style={styles.metaText}>Claim by {deadline}</Text> : null}
      </View>
    </Card>
  );
}

function EmptyState({ isWorker, needsLocation, onEnableLocation, onCreate }: {
  isWorker: boolean; needsLocation: boolean; onEnableLocation: () => void; onCreate: () => void;
}) {
  if (needsLocation) {
    return (
      <View style={styles.empty}>
        <View style={styles.emptyGlyph}><View style={styles.pinLarge} /></View>
        <Text style={styles.emptyTitle}>Location needed</Text>
        <Text style={styles.emptyDesc}>Enable location to discover quests near you.</Text>
        <Pressable onPress={onEnableLocation} accessibilityRole="button" style={styles.emptyAction}>
          <Text style={styles.emptyActionText}>Open settings</Text>
        </Pressable>
      </View>
    );
  }
  return (
    <View style={styles.empty}>
      <View style={styles.emptyGlyph}>
        <View style={styles.emptyBar1} />
        <View style={styles.emptyBar2} />
        <View style={styles.emptyBar3} />
      </View>
      <Text style={styles.emptyTitle}>{isWorker ? "No quests nearby" : "No quests yet"}</Text>
      <Text style={styles.emptyDesc}>
        {isWorker
          ? "Pull down to refresh, or move to a different area."
          : "Create your first quest to lock a reward in escrow."}
      </Text>
      {!isWorker && (
        <Pressable onPress={onCreate} accessibilityRole="button" style={styles.emptyAction}>
          <Text style={styles.emptyActionText}>Create a quest</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingHorizontal: spacing.xl, paddingVertical: spacing.lg,
  },
  headerLeft: { flex: 1 },
  heading: { ...typography.title, color: color.textPrimary },
  walletChip: { flexDirection: "row", alignItems: "center", gap: spacing.xs + 1, marginTop: spacing.xs + 1 },
  walletDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: color.success },
  walletAddr: { ...typography.caption, color: color.textSecondary, fontFamily: "monospace" },
  roleTag: { ...typography.caption, color: color.textMuted },

  headerActions: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  newBtn: {
    flexDirection: "row", alignItems: "center", gap: spacing.xs,
    backgroundColor: color.primary, borderRadius: radius.md,
    paddingHorizontal: spacing.md, minHeight: 40,
  },
  newBtnText: { color: color.onAccent, fontWeight: "700", fontSize: 14 },
  iconBtn: {
    width: 40, height: 40, borderRadius: radius.md, backgroundColor: color.surfaceHigh,
    alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: color.border,
  },
  pressed: { opacity: 0.7 },

  errorBanner: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: spacing.md,
    backgroundColor: color.dangerSoft, marginHorizontal: spacing.lg, marginBottom: spacing.sm,
    borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
  },
  errorText: { ...typography.caption, color: color.danger, flex: 1 },
  retryText: { ...typography.label, color: color.textPrimary, fontWeight: "700" },

  list: { padding: spacing.lg, gap: spacing.md },
  listEmpty: { flexGrow: 1, padding: spacing.lg },

  card: { gap: spacing.md },
  cardTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: spacing.md },
  cardTitle: { ...typography.heading, color: color.textPrimary, flex: 1 },

  rewardRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  rewardAmount: { ...typography.title, color: color.success, fontWeight: "800" },
  rewardUnit: { ...typography.label, color: color.success, alignSelf: "flex-end", marginBottom: 2 },

  metaRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  metaItem: { flexDirection: "row", alignItems: "center", gap: spacing.xs + 1 },
  metaText: { ...typography.caption, color: color.textMuted, fontWeight: "600", letterSpacing: 0.4 },

  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.sm, paddingHorizontal: spacing.xxxl },
  emptyGlyph: { width: 56, height: 56, alignItems: "center", justifyContent: "center", marginBottom: spacing.sm, gap: 5 },
  emptyBar1: { width: 36, height: 4, borderRadius: 2, backgroundColor: color.borderStrong },
  emptyBar2: { width: 26, height: 4, borderRadius: 2, backgroundColor: color.border },
  emptyBar3: { width: 30, height: 4, borderRadius: 2, backgroundColor: color.border },
  pinLarge: {
    width: 24, height: 28, borderRadius: 12, borderWidth: 3, borderColor: color.borderStrong,
    borderBottomLeftRadius: 3, borderBottomRightRadius: 3,
  },
  emptyTitle: { ...typography.heading, color: color.textPrimary, marginTop: spacing.sm },
  emptyDesc: { ...typography.body, color: color.textMuted, textAlign: "center" },
  emptyAction: {
    marginTop: spacing.lg, backgroundColor: color.surfaceHigh, borderWidth: 1, borderColor: color.borderStrong,
    borderRadius: radius.md, paddingHorizontal: spacing.xl, minHeight: 44, justifyContent: "center",
  },
  emptyActionText: { ...typography.bodyStrong, color: color.textPrimary },
});
