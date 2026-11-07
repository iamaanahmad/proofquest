import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
} from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList, Quest } from "../types";
import { useWalletStore } from "../store/wallet";
import { getQuest, updateQuest } from "../lib/appwrite";
import { buildClaimTx, buildApproveTx } from "../lib/transactions";
import { transact } from "@solana-mobile/mobile-wallet-adapter-protocol-web3js";
import { PublicKey } from "@solana/web3.js";

type Props = NativeStackScreenProps<RootStackParamList, "QuestDetail">;

export default function QuestDetailScreen({ route, navigation }: Props) {
  const { questPublicKey } = route.params;
  const { role, publicKey } = useWalletStore();
  const [quest, setQuest] = useState<Quest | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    getQuest(questPublicKey).then((data) => setQuest(data as unknown as Quest));
  }, [questPublicKey]);

  async function handleClaim() {
    if (!quest || !publicKey) return;
    setLoading(true);
    try {
      const id = BigInt(quest.questId);
      const tx = await buildClaimTx(new PublicKey(quest.creator), id, publicKey);

      await transact(async (wallet) => {
        await wallet.signAndSendTransactions({ transactions: [tx] });
      });

      await updateQuest(questPublicKey, { status: "claimed", worker: publicKey.toBase58() });

      navigation.navigate("Capture", { questPublicKey });
    } catch (e: any) {
      Alert.alert("Claim failed", e.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleApprove() {
    if (!quest || !publicKey) return;
    setLoading(true);
    try {
      const id = BigInt(quest.questId);
      const tx = await buildApproveTx(
        new PublicKey(quest.creator),
        id,
        new PublicKey(quest.worker!)
      );

      await transact(async (wallet) => {
        await wallet.signAndSendTransactions({ transactions: [tx] });
      });

      await updateQuest(questPublicKey, { status: "approved" });

      Alert.alert("Approved!", "Reward released to worker.");
      navigation.goBack();
    } catch (e: any) {
      Alert.alert("Approve failed", e.message);
    } finally {
      setLoading(false);
    }
  }

  if (!quest) return <ActivityIndicator style={{ flex: 1 }} color="#9945FF" />;

  const isWorker = role === "worker";
  const isCreator = role === "requester" && publicKey?.toBase58() === quest.creator;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>{quest.title ?? "Quest"}</Text>
      <Text style={styles.desc}>{quest.description}</Text>

      <View style={styles.row}>
        <Stat label="Reward" value={`${(quest.rewardAmount / 1_000_000).toFixed(2)} USDC`} />
        <Stat label="Area" value={quest.areaLabel ?? quest.coarseGeohash} />
        <Stat label="Status" value={quest.status} />
      </View>

      <View style={styles.row}>
        <Stat
          label="Claim by"
          value={new Date(quest.claimDeadline * 1000).toLocaleTimeString()}
        />
        <Stat
          label="Submit by"
          value={new Date(quest.submitDeadline * 1000).toLocaleTimeString()}
        />
      </View>

      <Text style={styles.sectionLabel}>Evidence required</Text>
      <Text style={styles.schemaHash}>
        Schema: {quest.evidenceSchemaHash.slice(0, 16)}…
      </Text>

      {isWorker && quest.status === "open" && (
        <TouchableOpacity
          style={[styles.btn, styles.btnClaim]}
          onPress={handleClaim}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#0f0f23" />
          ) : (
            <Text style={styles.btnText}>Claim Quest</Text>
          )}
        </TouchableOpacity>
      )}

      {isWorker && quest.status === "claimed" && quest.worker === publicKey?.toBase58() && (
        <TouchableOpacity
          style={[styles.btn, styles.btnCapture]}
          onPress={() => navigation.navigate("Capture", { questPublicKey })}
        >
          <Text style={styles.btnText}>Continue Capture</Text>
        </TouchableOpacity>
      )}

      {isCreator && quest.status === "submitted" && (
        <>
          <TouchableOpacity
            style={[styles.btn, styles.btnApprove]}
            onPress={() => navigation.navigate("Review", { questPublicKey })}
          >
            <Text style={styles.btnText}>Review Proof</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.btn, styles.btnApprove, { marginTop: 8 }]}
            onPress={handleApprove}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#0f0f23" />
            ) : (
              <Text style={styles.btnText}>Approve & Release</Text>
            )}
          </TouchableOpacity>
        </>
      )}
    </ScrollView>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0f0f23" },
  content: { padding: 24, paddingTop: 48 },
  title: { fontSize: 24, fontWeight: "800", color: "#fff", marginBottom: 8 },
  desc: { color: "#aaa", fontSize: 15, marginBottom: 20 },
  row: { flexDirection: "row", gap: 12, marginBottom: 16 },
  stat: { flex: 1, backgroundColor: "#1a1a3e", borderRadius: 10, padding: 12 },
  statLabel: { color: "#888", fontSize: 11, marginBottom: 4 },
  statValue: { color: "#fff", fontWeight: "700", fontSize: 14 },
  sectionLabel: { color: "#9945FF", fontWeight: "700", marginBottom: 4 },
  schemaHash: { color: "#555", fontSize: 12, marginBottom: 24 },
  btn: { paddingVertical: 16, borderRadius: 12, alignItems: "center", marginTop: 16 },
  btnClaim: { backgroundColor: "#14F195" },
  btnCapture: { backgroundColor: "#9945FF" },
  btnApprove: { backgroundColor: "#14F195" },
  btnText: { color: "#0f0f23", fontWeight: "700", fontSize: 16 },
});
