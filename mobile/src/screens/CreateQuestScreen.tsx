import React, { useState, useEffect, useRef } from "react";
import {
  View, Text, TextInput, Pressable, ScrollView,
  StyleSheet, ActivityIndicator, KeyboardAvoidingView, Platform,
  PermissionsAndroid, Linking, AppState, AppStateStatus,
} from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../types";
import { useWalletStore } from "../store/wallet";
import { signAndBroadcast, waitForConfirmation, BlockhashExpiredError } from "../hooks/useMWA";
import { insertQuest, ensureAppwriteSession } from "../lib/appwrite";
import { buildCreateAndFundTx } from "../lib/transactions";
import { connection, questPda, TEST_USDC_MINT } from "../lib/solana";
import { PublicKey } from "@solana/web3.js";
import Geolocation from "react-native-geolocation-service";
import Geohash from "ngeohash";
import AsyncStorage from "@react-native-async-storage/async-storage";
import "react-native-get-random-values";
import { Screen, ScreenHeader, Button, Card, Icon, useFeedback } from "../ui";
import { color, spacing, radius, typography } from "../theme/tokens";

type Props = NativeStackScreenProps<RootStackParamList, "CreateQuest">;

const PENDING_QUEST_KEY = "pending_quest_v1";

const TEMPLATES = [
  { id: "booth_open",  label: "Is this booth open?",      description: "Photo of the booth entrance showing open/closed status.", schemaHash: Array(32).fill(1) },
  { id: "poster_up",  label: "Did this poster go up?",    description: "Photo of the poster in place at the specified location.", schemaHash: Array(32).fill(2) },
  { id: "menu_price", label: "Verify today's menu price", description: "Photo of the menu board showing the item and price.",     schemaHash: Array(32).fill(3) },
  { id: "custom",     label: "Custom quest",              description: "",                                                        schemaHash: Array(32).fill(4) },
];

async function getLocationWithPermission(): Promise<GeolocationPosition> {
  const granted = await PermissionsAndroid.request(
    PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
    { title: "Location permission", message: "ProofQuest needs your location to tag this quest.", buttonPositive: "Allow", buttonNegative: "Deny" }
  );
  if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
    throw new Error("Location permission denied");
  }
  return new Promise<GeolocationPosition>((res, rej) =>
    Geolocation.getCurrentPosition(res, rej, { enableHighAccuracy: false, timeout: 10000 })
  );
}

async function completePendingQuest(pending: Record<string, any>): Promise<void> {
  const lastValidBlockHeight = typeof pending.lastValidBlockHeight === "number" ? pending.lastValidBlockHeight : undefined;
  const creator = pending.creator ? new PublicKey(pending.creator) : undefined;
  const questId = pending.questId ? BigInt(pending.questId) : undefined;
  await waitForConfirmation(pending.sig, { lastValidBlockHeight, creator, questId });
  await ensureAppwriteSession();
  await insertQuest(pending.questData);
  await AsyncStorage.removeItem(PENDING_QUEST_KEY);
}

export default function CreateQuestScreen({ navigation }: Props) {
  const { publicKey } = useWalletStore();
  const { alert } = useFeedback();
  const [templateIdx, setTemplateIdx] = useState(0);
  const [title, setTitle] = useState(TEMPLATES[0].label);
  const [description, setDescription] = useState(TEMPLATES[0].description);
  const [rewardUsdc, setRewardUsdc] = useState("1.00");
  const [claimMins, setClaimMins] = useState("60");
  const [loading, setLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");
  const resumingRef = useRef(false);

  async function tryResumePendingQuest() {
    if (resumingRef.current) return;
    const raw = await AsyncStorage.getItem(PENDING_QUEST_KEY);
    if (!raw) return;
    let pending: Record<string, any>;
    try { pending = JSON.parse(raw); } catch { await AsyncStorage.removeItem(PENDING_QUEST_KEY); return; }
    if (!pending.sig) { setStatusMsg("Pending quest has no signature yet."); return; }
    resumingRef.current = true;
    setLoading(true);
    setStatusMsg("Resuming — confirming transaction…");
    try {
      await completePendingQuest(pending);
      setStatusMsg("Quest confirmed and saved!");
      await alert({ title: "Quest published", message: `${(pending.questData.reward_amount / 1_000_000).toFixed(2)} USDC locked in escrow. Workers nearby can now claim it.`, tone: "success", confirmLabel: "View quests" });
      navigation.replace("Home");
    } catch (e: any) {
      await AsyncStorage.removeItem(PENDING_QUEST_KEY);
      const msg = e?.message ?? String(e);
      setStatusMsg(msg);
      await alert({ title: "Quest creation failed", message: msg, tone: "danger" });
    } finally {
      resumingRef.current = false;
      setLoading(false);
    }
  }

  useEffect(() => { tryResumePendingQuest(); }, []);
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s: AppStateStatus) => { if (s === "active") tryResumePendingQuest(); });
    return () => sub.remove();
  }, []);

  async function handleCreate() {
    if (!publicKey) { await alert({ title: "Wallet not connected", tone: "warning" }); return; }
    if (!title.trim()) { await alert({ title: "Title required", tone: "warning" }); return; }
    const reward = Math.round(parseFloat(rewardUsdc) * 1_000_000);
    if (isNaN(reward) || reward <= 0) { await alert({ title: "Invalid reward", message: "Enter a positive USDC amount.", tone: "warning" }); return; }

    setLoading(true);
    try {
      setStatusMsg("Getting location…");
      const pos = await getLocationWithPermission();
      const geohash = Geohash.encode(pos.coords.latitude, pos.coords.longitude, 4);
      const now = Math.floor(Date.now() / 1000);
      const claimDeadline = now + parseInt(claimMins) * 60;
      const submitDeadline = now + parseInt(claimMins) * 60 * 2;
      const questId = BigInt(Date.now());
      const template = TEMPLATES[templateIdx];
      const [questPdaKey] = questPda(publicKey, questId);

      const questData = {
        public_key: questPdaKey.toBase58(),
        quest_id: questId.toString(),
        creator: publicKey.toBase58(),
        mint: TEST_USDC_MINT.toBase58(),
        reward_amount: reward,
        status: "open",
        claim_deadline: claimDeadline,
        submit_deadline: submitDeadline,
        coarse_geohash: geohash,
        area_label: geohash,
        evidence_schema_hash: Buffer.from(template.schemaHash).toString("hex"),
        template_id: template.id,
        title: title.trim(),
        description: description.trim(),
        created_at: new Date().toISOString(),
      };

      setStatusMsg("Building transaction…");
      const tx = await buildCreateAndFundTx(publicKey, questId, reward, claimDeadline, submitDeadline, geohash, template.schemaHash);
      await AsyncStorage.setItem(PENDING_QUEST_KEY, JSON.stringify({ sig: null, questData }));
      const [questPdaKey2] = questPda(publicKey, questId);

      const MAX_SIGN_ATTEMPTS = 2;
      for (let attempt = 1; attempt <= MAX_SIGN_ATTEMPTS; attempt++) {
        setStatusMsg(attempt === 1 ? "Opening wallet — please sign…" : "Blockhash expired — retrying, please approve again…");

        let signResult: { sig: string; lastValidBlockHeight: number };
        try {
          signResult = await signAndBroadcast(tx);
        } catch (e: any) {
          await AsyncStorage.removeItem(PENDING_QUEST_KEY);
          throw e;
        }
        const sig = signResult.sig;
        setStatusMsg(`Signed! Confirming…`);
        await AsyncStorage.setItem(PENDING_QUEST_KEY, JSON.stringify({ sig, lastValidBlockHeight: signResult.lastValidBlockHeight, creator: publicKey.toBase58(), questId: questId.toString(), questData }));

        setStatusMsg("Waiting for on-chain confirmation…");
        try {
          await waitForConfirmation(sig, { lastValidBlockHeight: signResult.lastValidBlockHeight, creator: publicKey, questId });
          break;
        } catch (e: any) {
          if (!(e instanceof BlockhashExpiredError)) throw e;
          let pdaExists = false;
          try { pdaExists = !!(await connection.getAccountInfo(questPdaKey2)); } catch {}
          if (pdaExists) break;
          if (attempt >= MAX_SIGN_ATTEMPTS) {
            await AsyncStorage.removeItem(PENDING_QUEST_KEY);
            throw new Error("The blockhash expired twice. Check your connection and try again.");
          }
        }
      }

      setStatusMsg("Saving quest…");
      await ensureAppwriteSession();
      await insertQuest(questData);
      await AsyncStorage.removeItem(PENDING_QUEST_KEY);
      setStatusMsg("Quest published!");

      await alert({ title: "Quest published", message: `${(reward / 1_000_000).toFixed(2)} USDC locked in escrow. Workers nearby can now claim it.`, tone: "success", confirmLabel: "View quests" });
      navigation.replace("Home");
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      setStatusMsg(msg);
      if (msg !== "Location permission denied") {
        await alert({ title: "Failed to create quest", message: msg, tone: "danger" });
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <Screen>
      <ScreenHeader title="New Quest" onBack={() => navigation.goBack()} />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={0}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >

        <Text style={styles.sectionLabel}>TEMPLATE</Text>
        <View style={styles.templateGrid}>
          {TEMPLATES.map((t, i) => {
            const active = i === templateIdx;
            return (
              <Pressable
                key={t.id}
                accessibilityRole="radio"
                accessibilityState={{ selected: active }}
                accessibilityLabel={t.label}
                onPress={() => {
                  setTemplateIdx(i);
                  if (i !== 3) { setTitle(t.label); setDescription(t.description); }
                  else { setTitle(""); setDescription(""); }
                }}
                style={({ pressed }) => [styles.tplCard, active && styles.tplCardActive, pressed && styles.tplPressed]}
              >
                <View style={[styles.tplRadio, active && styles.tplRadioActive]}>
                  {active && <View style={styles.tplRadioDot} />}
                </View>
                <Text style={[styles.tplLabel, active && styles.tplLabelActive]} numberOfLines={2}>{t.label}</Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={styles.sectionLabel}>TITLE</Text>
        <TextInput style={styles.input} value={title} onChangeText={setTitle} placeholder="What needs verifying?" placeholderTextColor={color.textFaint} accessibilityLabel="Quest title" />

        <Text style={styles.sectionLabel}>DESCRIPTION</Text>
        <TextInput style={[styles.input, styles.inputMulti]} value={description} onChangeText={setDescription} multiline placeholder="Describe exactly what evidence is needed…" placeholderTextColor={color.textFaint} accessibilityLabel="Quest description" />

        <View style={styles.row}>
          <View style={styles.rowItem}>
            <Text style={styles.sectionLabel}>REWARD (USDC)</Text>
            <View style={styles.inputRow}>
              <Icon name="coin" size={18} color={color.success} />
              <TextInput style={[styles.input, styles.inputInline]} value={rewardUsdc} onChangeText={setRewardUsdc} keyboardType="decimal-pad" placeholderTextColor={color.textFaint} accessibilityLabel="Reward amount in USDC" />
            </View>
          </View>
          <View style={styles.rowItem}>
            <Text style={styles.sectionLabel}>CLAIM WINDOW</Text>
            <View style={styles.inputRow}>
              <Icon name="clock" size={18} color={color.textMuted} />
              <TextInput style={[styles.input, styles.inputInline]} value={claimMins} onChangeText={setClaimMins} keyboardType="number-pad" placeholderTextColor={color.textFaint} accessibilityLabel="Claim window in minutes" />
              <Text style={styles.inputSuffix}>min</Text>
            </View>
          </View>
        </View>

        <Card style={styles.escrowNotice}>
          <View style={styles.escrowRow}>
            <Icon name="lock" size={20} color={color.textMuted} />
            <Text style={styles.escrowText}>
              {rewardUsdc || "0"} USDC will be locked in on-chain escrow until you approve the evidence. Devnet only.
            </Text>
          </View>
        </Card>

        <Button label={loading ? "Publishing…" : "Fund & publish quest"} variant="primary" loading={loading} disabled={loading} onPress={handleCreate} />

        {statusMsg ? (
          <View style={styles.statusBox}>
            <Text style={styles.statusText} selectable>{statusMsg}</Text>
          </View>
        ) : null}

        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.xl, paddingBottom: spacing.huge, gap: spacing.sm },
  sectionLabel: { ...typography.overline, color: color.textMuted, marginTop: spacing.lg },

  templateGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  tplCard: {
    width: "47%", backgroundColor: color.surface, borderRadius: radius.md, padding: spacing.lg,
    borderWidth: 1, borderColor: color.border, gap: spacing.sm,
  },
  tplCardActive: { borderColor: color.primary, backgroundColor: color.primarySoft },
  tplPressed: { opacity: 0.85 },
  tplRadio: {
    width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: color.border,
    alignItems: "center", justifyContent: "center",
  },
  tplRadioActive: { borderColor: color.primary },
  tplRadioDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: color.primary },
  tplLabel: { ...typography.caption, color: color.textMuted },
  tplLabelActive: { color: color.textPrimary, fontWeight: "700" },

  input: {
    backgroundColor: color.surface, color: color.textPrimary, borderRadius: radius.md,
    padding: spacing.lg, ...typography.body, borderWidth: 1, borderColor: color.border,
  },
  inputMulti: { height: 90, textAlignVertical: "top" },
  row: { flexDirection: "row", gap: spacing.md, marginTop: spacing.lg },
  rowItem: { flex: 1 },
  inputRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  inputInline: { flex: 1 },
  inputSuffix: { ...typography.label, color: color.textMuted },

  escrowNotice: { marginTop: spacing.xl },
  escrowRow: { flexDirection: "row", gap: spacing.md, alignItems: "center" },
  escrowText: { ...typography.caption, color: color.textSecondary, flex: 1, lineHeight: 18 },

  statusBox: {
    backgroundColor: color.surfaceAlt, borderRadius: radius.md,
    padding: spacing.md, borderWidth: 1, borderColor: color.border,
  },
  statusText: { ...typography.caption, color: color.textSecondary, fontFamily: "monospace", lineHeight: 18 },
});
