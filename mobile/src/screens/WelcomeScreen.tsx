import React, { useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../types";
import { useMWA } from "../hooks/useMWA";
import { useWalletStore } from "../store/wallet";

type Props = NativeStackScreenProps<RootStackParamList, "Welcome">;

export default function WelcomeScreen({ navigation }: Props) {
  const [loading, setLoading] = useState(false);
  const { connect } = useMWA();
  const { setRole } = useWalletStore();

  async function handleConnect(role: "requester" | "worker") {
    setLoading(true);
    try {
      await connect();
      setRole(role);
      navigation.replace("Home");
    } catch (e: any) {
      Alert.alert("Connection failed", e.message ?? "Wallet rejected");
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>ProofQuest</Text>
      <Text style={styles.subtitle}>
        Request trusted real-world evidence.{"\n"}Get paid when you prove it.
      </Text>

      {loading ? (
        <ActivityIndicator size="large" color="#9945FF" />
      ) : (
        <>
          <TouchableOpacity
            style={[styles.btn, styles.btnPrimary]}
            onPress={() => handleConnect("requester")}
          >
            <Text style={styles.btnText}>I need something verified</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.btn, styles.btnSecondary]}
            onPress={() => handleConnect("worker")}
          >
            <Text style={styles.btnText}>I'll go verify it</Text>
          </TouchableOpacity>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0f0f23",
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
    gap: 16,
  },
  title: { fontSize: 36, fontWeight: "800", color: "#fff" },
  subtitle: {
    fontSize: 16,
    color: "#aaa",
    textAlign: "center",
    marginBottom: 24,
  },
  btn: {
    width: "100%",
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: "center",
  },
  btnPrimary: { backgroundColor: "#9945FF" },
  btnSecondary: { backgroundColor: "#14F195", marginTop: 8 },
  btnText: { color: "#0f0f23", fontWeight: "700", fontSize: 16 },
});
