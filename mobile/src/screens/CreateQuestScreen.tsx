import React, { useState, useEffect, useRef } from "react";
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, Alert, ActivityIndicator, StatusBar,
  PermissionsAndroid, Linking, AppState, AppStateStatus,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../types";
import { useWalletStore } from "../store/wallet";
import { signAndBroadcast, waitForConfirmation } from "../hooks/useMWA";
import { insertQuest, ensureAppwriteSession } from "../lib/appwrite";
import { buildCreateAndFundTx } from "../lib/transactions";
import { questPda, TEST_USDC_MINT } from "../lib/solana";
import { PublicKey } from "@solana/web3.js";
import Geolocation from "react-native-geolocation-service";
import Geohash from "ngeohash";
import AsyncStorage from "@react-native-async-storage/async-storage";
import "react-native-get-random-values";

type Props = NativeStackScreenProps<RootStackParamList, "CreateQuest">;

// Key used to persist a quest that was signed but not yet saved to Appwrite.
// Survives the app being backgrounded/frozen during the Phantom interaction.
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
    {
      title: "Location Permission",
      message: "ProofQuest needs your location to tag this quest.",
      buttonPositive: "Allow",
      buttonNegative: "Deny",
    }
  );
  if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
    return new Promise((_, reject) => {
      Alert.alert(
        "Location Required",
        "Location permission is needed to create a quest. Please enable it in app settings.",
        [
          { text: "Open Settings", onPress: () => { Linking.openSettings(); reject(new Error("Location permission denied")); } },
          { text: "Cancel", style: "cancel", onPress: () => reject(new Error("Location permission denied")) },
        ]
      );
    });
  }
  return new Promise<GeolocationPosition>((res, rej) =>
    Geolocation.getCurrentPosition(res, rej, { enableHighAccuracy: false, timeout: 10000 })
  );
}

/**
 * Try to complete a pending quest: confirm the tx on-chain, save to Appwrite,
 * clear the pending record.
 */
async function completePendingQuest(pending: Record<string, any>): Promise<void> {
  // Backward-compat: older persisted records (written before these fields
  // existed) lack lastValidBlockHeight/creator/questId. Missing fields simply
  // disable that check, falling back to signature-status polling.
  const lastValidBlockHeight =
    typeof pending.lastValidBlockHeight === "number"
      ? pending.lastValidBlockHeight
      : undefined;
  const creator = pending.creator ? new PublicKey(pending.creator) : undefined;
  const questId = pending.questId ? BigInt(pending.questId) : undefined;

  await waitForConfirmation(pending.sig, { lastValidBlockHeight, creator, questId });
  await ensureAppwriteSession();
  await insertQuest(pending.questData);
  await AsyncStorage.removeItem(PENDING_QUEST_KEY);
}

export default function CreateQuestScreen({ navigation }: Props) {
  const { publicKey } = useWalletStore();
  const [templateIdx, setTemplateIdx] = useState(0);
  const [title, setTitle] = useState(TEMPLATES[0].label);
  const [description, setDescription] = useState(TEMPLATES[0].description);
  const [rewardUsdc, setRewardUsdc] = useState("1.00");
  const [claimMins, setClaimMins] = useState("60");
  const [loading, setLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");

  // Track whether we're already processing a resume to avoid duplicate runs
  const resumingRef = useRef(false);

  /**
   * Called whenever the app comes to the foreground.
   * Checks AsyncStorage for a pending quest and tries to complete it.
   */
  async function tryResumePendingQuest() {
    if (resumingRef.current) return;
    const raw = await AsyncStorage.getItem(PENDING_QUEST_KEY);
    if (!raw) return;

    let pending: Record<string, any>;
    try {
      pending = JSON.parse(raw);
    } catch {
      await AsyncStorage.removeItem(PENDING_QUEST_KEY);
      return;
    }

    // If sig is null, the wallet interaction didn't finish — skip
    if (!pending.sig) {
      setStatusMsg("⚠️ Pending quest has no signature yet");
      return;
    }

    resumingRef.current = true;
    setLoading(true);
    setStatusMsg("🔄 Resuming: confirming transaction…");
    try {
      await completePendingQuest(pending);
      setStatusMsg("✅ Quest confirmed and saved!");
      Alert.alert(
        "Quest Published",
        `${(pending.questData.reward_amount / 1_000_000).toFixed(2)} USDC locked in escrow. Workers nearby can now claim it.`,
        [{ text: "View Quests", onPress: () => navigation.replace("Home") }]
      );
    } catch (e: any) {
      await AsyncStorage.removeItem(PENDING_QUEST_KEY);
      const msg = e?.message ?? String(e);
      setStatusMsg(`❌ Resume failed: ${msg}`);
      Alert.alert("Quest creation failed", msg);
    } finally {
      resumingRef.current = false;
      setLoading(false);
    }
  }

  // On mount: check for any quest that was left pending from a previous session
  useEffect(() => {
    tryResumePendingQuest();
  }, []);

  // On foreground resume: check again (handles the case where the JS thread
  // was suspended while Phantom was open and resumes when we come back)
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state: AppStateStatus) => {
      if (state === "active") {
        tryResumePendingQuest();
      }
    });
    return () => sub.remove();
  }, []);

  async function handleCreate() {
    if (!publicKey) { Alert.alert("Wallet not connected"); return; }
    if (!title.trim()) { Alert.alert("Title required"); return; }
    const reward = Math.round(parseFloat(rewardUsdc) * 1_000_000);
    if (isNaN(reward) || reward <= 0) { Alert.alert("Invalid reward amount"); return; }

    setLoading(true);
    try {
      setStatusMsg("📍 Getting location…");
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

      setStatusMsg("🔨 Building transaction…");
      const tx = await buildCreateAndFundTx(
        publicKey, questId, reward, claimDeadline, submitDeadline, geohash, template.schemaHash
      );

      // Step 1: persist quest data (sig = null until we have it)
      await AsyncStorage.setItem(PENDING_QUEST_KEY, JSON.stringify({ sig: null, questData }));
      setStatusMsg("📲 Opening wallet — please sign…");

      let signResult: { sig: string; lastValidBlockHeight: number };
      try {
        signResult = await signAndBroadcast(tx);
      } catch (e: any) {
        // User rejected or wallet error — tx was never sent, clear pending
        await AsyncStorage.removeItem(PENDING_QUEST_KEY);
        throw e;
      }
      const sig = signResult.sig;

      setStatusMsg(`✍️ Signed! sig: ${sig.slice(0, 12)}… Saving…`);
      // Step 2: persist signature + confirmation metadata so the AppState path
      // can confirm (blockheight-aware + PDA fallback) if needed.
      await AsyncStorage.setItem(
        PENDING_QUEST_KEY,
        JSON.stringify({
          sig,
          lastValidBlockHeight: signResult.lastValidBlockHeight,
          creator: publicKey.toBase58(),
          questId: questId.toString(),
          questData,
        })
      );

      setStatusMsg("⏳ Waiting for on-chain confirmation…");
      // Step 3: wait for on-chain confirmation, then save to Appwrite
      await waitForConfirmation(sig, {
        lastValidBlockHeight: signResult.lastValidBlockHeight,
        creator: publicKey,
        questId,
      });

      setStatusMsg("💾 Saving quest to database…");
      await ensureAppwriteSession();
      await insertQuest(questData);
      await AsyncStorage.removeItem(PENDING_QUEST_KEY);
      setStatusMsg("✅ Quest published!");

      Alert.alert(
        "Quest Published",
        `${(reward / 1_000_000).toFixed(2)} USDC locked in escrow. Workers nearby can now claim it.`,
        [{ text: "View Quests", onPress: () => navigation.replace("Home") }]
      );
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      setStatusMsg(`❌ Error: ${msg}`);
      // "Location permission denied" already shows its own Alert (with Settings
      // button) via getLocationWithPermission — don't double-alert for it.
      if (msg !== "Location permission denied") {
        Alert.alert("Failed to create quest", msg || "Unknown error");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <StatusBar barStyle="light-content" backgroundColor="#080818" />

      <View style={styles.navbar}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.navBack}>‹ Back</Text>
        </TouchableOpacity>
        <Text style={styles.navTitle}>New Quest</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

        <Text style={styles.sectionLabel}>TEMPLATE</Text>
        <View style={styles.templateGrid}>
          {TEMPLATES.map((t, i) => (
            <TouchableOpacity
              key={t.id}
              style={[styles.templateCard, i === templateIdx && styles.templateCardActive]}
              onPress={() => {
                setTemplateIdx(i);
                if (i !== 3) { setTitle(t.label); setDescription(t.description); }
                else { setTitle(""); setDescription(""); }
              }}
            >
              <View style={[styles.templateDot, i === templateIdx && styles.templateDotActive]} />
              <Text style={[styles.templateLabel, i === templateIdx && styles.templateLabelActive]} numberOfLines={2}>
                {t.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.sectionLabel}>TITLE</Text>
        <TextInput
          style={styles.input}
          value={title}
          onChangeText={setTitle}
          placeholder="What needs verifying?"
          placeholderTextColor="#333"
        />

        <Text style={styles.sectionLabel}>DESCRIPTION</Text>
        <TextInput
          style={[styles.input, styles.inputMulti]}
          value={description}
          onChangeText={setDescription}
          multiline
          placeholder="Describe exactly what evidence is needed…"
          placeholderTextColor="#333"
        />

        <View style={styles.row}>
          <View style={styles.rowItem}>
            <Text style={styles.sectionLabel}>REWARD (USDC)</Text>
            <View style={styles.inputRow}>
              <Text style={styles.inputPrefix}>$</Text>
              <TextInput
                style={[styles.input, styles.inputInline]}
                value={rewardUsdc}
                onChangeText={setRewardUsdc}
                keyboardType="decimal-pad"
                placeholderTextColor="#333"
              />
            </View>
          </View>
          <View style={styles.rowItem}>
            <Text style={styles.sectionLabel}>CLAIM WINDOW</Text>
            <View style={styles.inputRow}>
              <TextInput
                style={[styles.input, styles.inputInline]}
                value={claimMins}
                onChangeText={setClaimMins}
                keyboardType="number-pad"
                placeholderTextColor="#333"
              />
              <Text style={styles.inputSuffix}>min</Text>
            </View>
          </View>
        </View>

        <View style={styles.notice}>
          <View style={styles.lockIcon}>
            <View style={styles.lockBody} />
            <View style={styles.lockShackle} />
          </View>
          <Text style={styles.noticeText}>
            {rewardUsdc || "0"} USDC will be locked in on-chain escrow until you approve the evidence. Devnet only.
          </Text>
        </View>

        <TouchableOpacity
          style={[styles.submitBtn, loading && styles.submitBtnDisabled]}
          onPress={handleCreate}
          disabled={loading}
          activeOpacity={0.8}
        >
          {loading ? (
            <View style={styles.submitLoading}>
              <ActivityIndicator color="#080818" size="small" />
              <Text style={styles.submitBtnText}>Publishing…</Text>
            </View>
          ) : (
            <Text style={styles.submitBtnText}>Fund & Publish Quest</Text>
          )}
        </TouchableOpacity>

        {statusMsg ? (
          <View style={styles.statusBox}>
            <Text style={styles.statusText} selectable>{statusMsg}</Text>
          </View>
        ) : null}

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#080818" },
  navbar: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: "#111128",
  },
  navBack: { color: "#9945FF", fontWeight: "700", fontSize: 17 },
  navTitle: { color: "#fff", fontWeight: "800", fontSize: 17 },

  content: { padding: 20, paddingBottom: 48 },
  sectionLabel: { color: "#444", fontSize: 11, fontWeight: "700", letterSpacing: 1, marginBottom: 8, marginTop: 20 },

  templateGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  templateCard: {
    width: "47%", backgroundColor: "#0e0e24", borderRadius: 14, padding: 14,
    borderWidth: 1, borderColor: "#1a1a3e", gap: 8,
  },
  templateCardActive: { borderColor: "#9945FF", backgroundColor: "#9945FF11" },
  templateDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#222" },
  templateDotActive: { backgroundColor: "#9945FF" },
  templateLabel: { color: "#555", fontSize: 12, lineHeight: 16 },
  templateLabelActive: { color: "#fff", fontWeight: "700" },

  input: {
    backgroundColor: "#0e0e24", color: "#fff", borderRadius: 12,
    padding: 14, fontSize: 15, borderWidth: 1, borderColor: "#1a1a3e",
  },
  inputMulti: { height: 90, textAlignVertical: "top" },
  row: { flexDirection: "row", gap: 12 },
  rowItem: { flex: 1 },
  inputRow: { flexDirection: "row", alignItems: "center" },
  inputPrefix: { color: "#555", fontSize: 16, marginRight: 6 },
  inputSuffix: { color: "#555", fontSize: 13, marginLeft: 6 },
  inputInline: { flex: 1 },

  notice: {
    flexDirection: "row", gap: 12, alignItems: "center", backgroundColor: "#0e0e24",
    borderRadius: 12, padding: 14, marginTop: 20, borderWidth: 1, borderColor: "#1a1a3e",
  },
  lockIcon: { width: 18, height: 20, alignItems: "center" },
  lockBody: { width: 14, height: 10, borderRadius: 3, backgroundColor: "#555", marginTop: 6 },
  lockShackle: {
    width: 10, height: 8, borderRadius: 5,
    borderWidth: 2, borderColor: "#555", borderBottomWidth: 0,
    position: "absolute", top: 0,
  },
  noticeText: { color: "#555", fontSize: 13, flex: 1, lineHeight: 18 },

  submitBtn: {
    backgroundColor: "#9945FF", borderRadius: 14, paddingVertical: 16,
    alignItems: "center", marginTop: 24,
  },
  submitBtnDisabled: { opacity: 0.6 },
  submitLoading: { flexDirection: "row", alignItems: "center", gap: 8 },
  submitBtnText: { color: "#fff", fontWeight: "800", fontSize: 16 },

  statusBox: {
    marginTop: 16, backgroundColor: "#0e0e24", borderRadius: 10,
    padding: 12, borderWidth: 1, borderColor: "#1a1a3e",
  },
  statusText: { color: "#aaa", fontSize: 12, fontFamily: "monospace", lineHeight: 18 },
});
