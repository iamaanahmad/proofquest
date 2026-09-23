import React, { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  Alert,
} from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList, Quest } from "../types";
import { useWalletStore } from "../store/wallet";
import { listNearbyQuests, listMyQuests } from "../lib/appwrite";
import Geolocation from "react-native-geolocation-service";
import Geohash from "ngeohash";

type Props = NativeStackScreenProps<RootStackParamList, "Home">;

export default function HomeScreen({ navigation }: Props) {
  const { role, publicKey } = useWalletStore();
  const [quests, setQuests] = useState<Quest[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      if (role === "worker") {
        const pos = await new Promise<GeolocationPosition>((res, rej) =>
          Geolocation.getCurrentPosition(res, rej, { enableHighAccuracy: false, timeout: 5000 })
        );
        const gh = Geohash.encode(pos.coords.latitude, pos.coords.longitude, 4);
        const res = await listNearbyQuests(gh.slice(0, 3));
        setQuests(res.documents as unknown as Quest[]);
      } else {
        const res = await listMyQuests(publicKey!.toBase58());
        setQuests(res.documents as unknown as Quest[]);
      }
    } catch (e: any) {
      Alert.alert("Load failed", e.message);
    } finally {
      setRefreshing(false);
    }
  }, [role, publicKey]);

  useEffect(() => { load(); }, [load]);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.heading}>
          {role === "worker" ? "Nearby Quests" : "My Quests"}
        </Text>
        {role === "requester" && (
          <TouchableOpacity
            style={styles.createBtn}
            onPress={() => navigation.navigate("CreateQuest")}
          >
            <Text style={styles.createBtnText}>+ New</Text>
          </TouchableOpacity>
        )}
      </View>

      <FlatList
        data={quests}
        keyExtractor={(q) => q.publicKey}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} />}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.card}
            onPress={() => navigation.navigate("QuestDetail", { questPublicKey: item.publicKey })}
          >
            <Text style={styles.cardTitle}>{item.title ?? "Quest"}</Text>
            <Text style={styles.cardMeta}>
              {(item.rewardAmount / 1_000_000).toFixed(2)} USDC ·{" "}
              {item.areaLabel ?? item.coarseGeohash} ·{" "}
              <Text style={statusColor(item.status)}>{item.status}</Text>
            </Text>
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          <Text style={styles.empty}>{refreshing ? "" : "No quests found nearby."}</Text>
        }
      />
    </View>
  );
}

function statusColor(s: Quest["status"]) {
  const colors: Record<Quest["status"], string> = {
    open: "#14F195", claimed: "#FFD700", submitted: "#9945FF",
    approved: "#00C853", cancelled: "#888", refunded: "#888",
  };
  return { color: colors[s] };
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0f0f23" },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 20, paddingTop: 48 },
  heading: { fontSize: 24, fontWeight: "800", color: "#fff" },
  createBtn: { backgroundColor: "#9945FF", paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8 },
  createBtnText: { color: "#fff", fontWeight: "700" },
  card: { backgroundColor: "#1a1a3e", marginHorizontal: 16, marginBottom: 12, padding: 16, borderRadius: 12 },
  cardTitle: { color: "#fff", fontSize: 16, fontWeight: "700" },
  cardMeta: { color: "#aaa", fontSize: 13, marginTop: 4 },
  empty: { color: "#555", textAlign: "center", marginTop: 60, fontSize: 15 },
});
