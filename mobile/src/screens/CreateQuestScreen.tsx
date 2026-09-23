import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Alert,
  ActivityIndicator,
} from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../types";
import { useWalletStore } from "../store/wallet";
import { insertQuest } from "../lib/appwrite";
import { buildCreateAndFundTx } from "../lib/transactions";
import { questPda, TEST_USDC_MINT } from "../lib/solana";
import { transact } from "@solana-mobile/mobile-wallet-adapter-protocol-web3js";
import Geolocation from "react-native-geolocation-service";
import Geohash from "ngeohash";
import "react-native-get-random-values";

type Props = NativeStackScreenProps<RootStackParamList, "CreateQuest">;

const TEMPLATES = [
  {
    id: "booth_open",
    label: "Is this booth open?",
    description: "Photo of the booth entrance showing open/closed status.",
    schemaHash: Array(32).fill(1),
  },
  {
    id: "poster_up",
    label: "Did this poster go up?",
    description: "Photo of the poster in place at the specified location.",
    schemaHash: Array(32).fill(2),
  },
  {
    id: "menu_price",
    label: "Verify today's menu price",
    description: "Photo of the menu board showing the item and price.",
    schemaHash: Array(32).fill(3),
  },
];

export default function CreateQuestScreen({ navigation }: Props) {
  const { publicKey } = useWalletStore();
  const [templateIdx, setTemplateIdx] = useState(0);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [rewardUsdc, setRewardUsdc] = useState("1.00");
  const [claimMins, setClaimMins] = useState("60");
  const [submitMins, setSubmitMins] = useState("120");
  const [loading, setLoading] = useState(false);

  async function handleCreate() {
    if (!publicKey) return;
    const reward = Math.round(parseFloat(rewardUsdc) * 1_000_000);
    if (isNaN(reward) || reward <= 0) {
      Alert.alert("Invalid reward");
      return;
    }

    setLoading(true);
    try {
      const pos = await new Promise<GeolocationPosition>((res, rej) =>
        Geolocation.getCurrentPosition(res, rej, { enableHighAccuracy: false, timeout: 5000 })
      );
      const geohash = Geohash.encode(pos.coords.latitude, pos.coords.longitude, 4);

      const now = Math.floor(Date.now() / 1000);
      const claimDeadline = now + parseInt(claimMins) * 60;
      const submitDeadline = now + parseInt(submitMins) * 60;
      const questId = BigInt(Date.now());
      const template = TEMPLATES[templateIdx];

      const [questPdaKey] = questPda(publicKey, questId);

      const tx = await buildCreateAndFundTx(
        publicKey,
        questId,
        reward,
        claimDeadline,
        submitDeadline,
        geohash,
        template.schemaHash
      );

      await transact(async (wallet) => {
        await wallet.signAndSendTransactions({ transactions: [tx] });
      });

      await insertQuest({
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
        title: title || template.label,
        description: description || template.description,
        created_at: new Date().toISOString(),
      });

      Alert.alert("Quest created!", "Workers nearby can now claim it.", [
        { text: "OK", onPress: () => navigation.replace("Home") },
      ]);
    } catch (e: any) {
      Alert.alert("Create failed", e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.heading}>New Quest</Text>

      <Text style={styles.label}>Template</Text>
      <View style={styles.templates}>
        {TEMPLATES.map((t, i) => (
          <TouchableOpacity
            key={t.id}
            style={[styles.templateBtn, i === templateIdx && styles.templateBtnActive]}
            onPress={() => {
              setTemplateIdx(i);
              setTitle(t.label);
              setDescription(t.description);
            }}
          >
            <Text style={[styles.templateText, i === templateIdx && styles.templateTextActive]}>
              {t.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.label}>Title</Text>
      <TextInput
        style={styles.input}
        value={title}
        onChangeText={setTitle}
        placeholder="What needs verifying?"
        placeholderTextColor="#555"
      />

      <Text style={styles.label}>Description</Text>
      <TextInput
        style={[styles.input, { height: 80 }]}
        value={description}
        onChangeText={setDescription}
        multiline
        placeholderTextColor="#555"
      />

      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          <Text style={styles.label}>Reward (USDC)</Text>
          <TextInput
            style={styles.input}
            value={rewardUsdc}
            onChangeText={setRewardUsdc}
            keyboardType="decimal-pad"
            placeholderTextColor="#555"
          />
        </View>
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text style={styles.label}>Claim window (min)</Text>
          <TextInput
            style={styles.input}
            value={claimMins}
            onChangeText={setClaimMins}
            keyboardType="number-pad"
            placeholderTextColor="#555"
          />
        </View>
      </View>

      <Text style={styles.disclaimer}>
        ⚠ Reward is locked in escrow until you approve. Devnet test USDC only.
      </Text>

      <TouchableOpacity
        style={[styles.btn, loading && { opacity: 0.6 }]}
        onPress={handleCreate}
        disabled={loading}
      >
        {loading ? (
          <ActivityIndicator color="#0f0f23" />
        ) : (
          <Text style={styles.btnText}>Fund & Publish Quest</Text>
        )}
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0f0f23" },
  content: { padding: 24, paddingTop: 48, paddingBottom: 48 },
  heading: { fontSize: 24, fontWeight: "800", color: "#fff", marginBottom: 24 },
  label: { color: "#888", fontSize: 12, marginBottom: 6, marginTop: 16 },
  input: {
    backgroundColor: "#1a1a3e",
    color: "#fff",
    borderRadius: 10,
    padding: 14,
    fontSize: 15,
  },
  templates: { gap: 8 },
  templateBtn: {
    backgroundColor: "#1a1a3e",
    borderRadius: 10,
    padding: 14,
    borderWidth: 1,
    borderColor: "transparent",
  },
  templateBtnActive: { borderColor: "#9945FF" },
  templateText: { color: "#aaa", fontSize: 14 },
  templateTextActive: { color: "#fff", fontWeight: "700" },
  row: { flexDirection: "row" },
  disclaimer: { color: "#666", fontSize: 12, marginTop: 20, lineHeight: 18 },
  btn: {
    backgroundColor: "#9945FF",
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: "center",
    marginTop: 24,
  },
  btnText: { color: "#fff", fontWeight: "700", fontSize: 16 },
});
