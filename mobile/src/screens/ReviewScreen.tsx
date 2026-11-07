import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  Image,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../types";
import { getManifest, getEvidencePreviewUrl } from "../lib/appwrite";
import { sha256, toHex } from "../lib/manifest";

type Props = NativeStackScreenProps<RootStackParamList, "Review">;

export default function ReviewScreen({ route }: Props) {
  const { questPublicKey } = route.params;
  const [manifest, setManifest] = useState<any>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [hashMatch, setHashMatch] = useState<boolean | null>(null);

  useEffect(() => {
    async function load() {
      const doc = await getManifest(questPublicKey);
      if (!doc) return;

      const parsed = JSON.parse(doc.manifest);
      setManifest(parsed);

      const recomputed = toHex(sha256(doc.manifest));
      setHashMatch(recomputed === doc.manifest_hash);

      if (parsed.storageObjectId) {
        setImageUrl(getEvidencePreviewUrl(parsed.storageObjectId));
      }
    }
    load();
  }, [questPublicKey]);

  if (!manifest) return <ActivityIndicator style={{ flex: 1 }} color="#9945FF" />;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.heading}>Proof Packet</Text>

      <View style={[styles.badge, hashMatch ? styles.badgeOk : styles.badgeFail]}>
        <Text style={styles.badgeText}>
          {hashMatch ? "✓ Hash verified" : "✗ Hash mismatch"}
        </Text>
      </View>

      {imageUrl && (
        <Image source={{ uri: imageUrl }} style={styles.photo} resizeMode="cover" />
      )}

      <Field label="Worker" value={manifest.workerWallet} mono />
      <Field label="Captured" value={new Date(manifest.captureTimestamp * 1000).toLocaleString()} />
      <Field label="Location (coarse)" value={manifest.coarseLocation?.geohash} />
      <Field label="Media SHA-256" value={manifest.mediaSha256} mono />
      <Field label="Nonce" value={manifest.nonce} mono />
      {manifest.qrChallengeResult && (
        <Field label="QR Challenge" value={manifest.qrChallengeResult} />
      )}
      <Field label="App version" value={manifest.appVersion} />
    </ScrollView>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Text style={[styles.fieldValue, mono && styles.mono]} numberOfLines={2}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0f0f23" },
  content: { padding: 24, paddingTop: 48 },
  heading: { fontSize: 22, fontWeight: "800", color: "#fff", marginBottom: 16 },
  badge: { borderRadius: 8, padding: 10, marginBottom: 16, alignItems: "center" },
  badgeOk: { backgroundColor: "#0d3320" },
  badgeFail: { backgroundColor: "#3d0d0d" },
  badgeText: { color: "#14F195", fontWeight: "700" },
  photo: { width: "100%", height: 220, borderRadius: 12, marginBottom: 20 },
  field: { marginBottom: 14 },
  fieldLabel: { color: "#888", fontSize: 11, marginBottom: 2 },
  fieldValue: { color: "#fff", fontSize: 14 },
  mono: { fontFamily: "monospace", fontSize: 12, color: "#aaa" },
});
