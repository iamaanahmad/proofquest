import React, { useEffect, useState } from "react";
import { View, Text, ScrollView, Image, StyleSheet, ActivityIndicator } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../types";
import { getManifest, getEvidencePreviewUrl, ensureAppwriteSession } from "../lib/appwrite";
import { sha256, toHex } from "../lib/manifest";
import { Screen, ScreenHeader, Card, Button, Icon } from "../ui";
import { color, spacing, radius, typography } from "../theme/tokens";

type Props = NativeStackScreenProps<RootStackParamList, "Review">;

export default function ReviewScreen({ route, navigation }: Props) {
  const { questPublicKey } = route.params;
  const [manifest, setManifest] = useState<any>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [hashMatch, setHashMatch] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        await ensureAppwriteSession();
        const doc = await getManifest(questPublicKey);
        if (!doc) {
          setLoading(false);
          return;
        }
        const parsed = JSON.parse(doc.manifest);
        setManifest(parsed);
        setHashMatch(toHex(sha256(doc.manifest)) === doc.manifest_hash);
        if (parsed.storageObjectId) setImageUrl(getEvidencePreviewUrl(parsed.storageObjectId));
      } catch (e: any) {
        setLoadError(e?.message ?? "Failed to load proof");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [questPublicKey]);

  if (loading) {
    return (
      <Screen>
        <ScreenHeader title="Proof packet" onBack={() => navigation.goBack()} />
        <View style={styles.center}>
          <ActivityIndicator color={color.primary} size="large" />
          <Text style={styles.loadingText}>Loading proof packet…</Text>
        </View>
      </Screen>
    );
  }

  if (loadError) {
    return (
      <Screen>
        <ScreenHeader title="Proof packet" onBack={() => navigation.goBack()} />
        <View style={styles.center}>
          <Icon name="alert" size={40} color={color.danger} />
          <Text style={styles.emptyText}>Failed to load proof</Text>
          <Text style={[styles.loadingText, { textAlign: "center", paddingHorizontal: 24 }]}>{loadError}</Text>
          <Button label="Go back" variant="secondary" onPress={() => navigation.goBack()} />
        </View>
      </Screen>
    );
  }

  if (!manifest) {
    return (
      <Screen>
        <ScreenHeader title="Proof packet" onBack={() => navigation.goBack()} />
        <View style={styles.center}>
          <Icon name="doc" size={40} color={color.textMuted} />
          <Text style={styles.emptyText}>No proof submitted yet</Text>
          <Button label="Go back" variant="secondary" onPress={() => navigation.goBack()} />
        </View>
      </Screen>
    );
  }

  const verified = hashMatch === true;

  return (
    <Screen>
      <ScreenHeader title="Proof packet" onBack={() => navigation.goBack()} />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Verification banner */}
        <View style={[styles.verify, { backgroundColor: verified ? color.successSoft : color.dangerSoft, borderColor: (verified ? color.success : color.danger) + "40" }]}>
          <View style={[styles.verifyIcon, { backgroundColor: (verified ? color.success : color.danger) + "22" }]}>
            <Icon name={verified ? "shield-check" : "alert"} size={24} color={verified ? color.success : color.danger} />
          </View>
          <View style={styles.verifyText}>
            <Text style={[styles.verifyTitle, { color: verified ? color.success : color.danger }]}>
              {verified ? "Hash verified" : "Hash mismatch"}
            </Text>
            <Text style={styles.verifyDesc}>
              {verified ? "Manifest integrity confirmed on-chain." : "Manifest may have been tampered with."}
            </Text>
          </View>
        </View>

        {/* Evidence photo */}
        {imageUrl && (
          <View style={styles.photoWrap}>
            <Image source={{ uri: imageUrl }} style={styles.photo} resizeMode="cover" />
            <View style={styles.photoTag}>
              <Icon name="camera" size={13} color={color.white} />
              <Text style={styles.photoTagText}>Evidence photo</Text>
            </View>
          </View>
        )}

        {/* Metadata */}
        <Card padded={false} style={styles.card}>
          <Field icon="wallet" label="Worker wallet" value={manifest.workerWallet} mono />
          <Divider />
          <Field icon="clock" label="Captured at" value={new Date(manifest.captureTimestamp * 1000).toLocaleString()} />
          <Divider />
          <Field icon="pin" label="Coarse location" value={`Geohash ${manifest.coarseLocation?.geohash}`} />
          <Divider />
          <Field icon="pin" label="GPS accuracy" value={`±${Math.round(manifest.coarseLocation?.accuracy ?? 0)} m`} />
          <Divider />
          <Field icon="doc" label="App version" value={manifest.appVersion} />
        </Card>

        <Card padded={false} style={styles.card}>
          <Field icon="shield-check" label="Media SHA-256" value={manifest.mediaSha256} mono />
          <Divider />
          <Field icon="lock" label="Nonce" value={manifest.nonce} mono />
        </Card>

        {manifest.qrChallengeResult && (
          <Card padded={false} style={styles.card}>
            <Field icon="check" label="QR challenge result" value={manifest.qrChallengeResult} />
          </Card>
        )}

        {/* On-chain note */}
        <View style={styles.chainNote}>
          <Icon name="link" size={18} color={color.primary} />
          <Text style={styles.chainText}>
            The SHA-256 manifest hash is permanently recorded on Solana devnet.
          </Text>
        </View>
      </ScrollView>
    </Screen>
  );
}

function Field({ icon, label, value, mono }: { icon: any; label: string; value: string; mono?: boolean }) {
  return (
    <View style={styles.field}>
      <Icon name={icon} size={16} color={color.textMuted} />
      <View style={styles.fieldText}>
        <Text style={styles.fieldLabel}>{label}</Text>
        <Text style={[styles.fieldValue, mono && styles.mono]} numberOfLines={2}>{value}</Text>
      </View>
    </View>
  );
}

function Divider() {
  return <View style={styles.divider} />;
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md },
  loadingText: { ...typography.caption, color: color.textMuted, marginTop: spacing.sm },
  emptyText: { ...typography.body, color: color.textMuted },

  content: { padding: spacing.xl, paddingBottom: spacing.huge, gap: spacing.lg },

  verify: { flexDirection: "row", alignItems: "center", gap: spacing.md, borderRadius: radius.lg, padding: spacing.lg, borderWidth: 1 },
  verifyIcon: { width: 44, height: 44, borderRadius: radius.md, alignItems: "center", justifyContent: "center" },
  verifyText: { flex: 1 },
  verifyTitle: { ...typography.heading },
  verifyDesc: { ...typography.caption, color: color.textMuted, marginTop: 2 },

  photoWrap: { borderRadius: radius.lg, overflow: "hidden" },
  photo: { width: "100%", height: 240, backgroundColor: color.surface },
  photoTag: {
    position: "absolute", bottom: 0, left: 0, right: 0,
    flexDirection: "row", alignItems: "center", gap: spacing.xs + 2,
    backgroundColor: "rgba(0,0,0,0.55)", padding: spacing.md,
  },
  photoTagText: { ...typography.caption, color: color.white },

  card: { overflow: "hidden" },
  field: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.lg },
  fieldText: { flex: 1 },
  fieldLabel: { ...typography.caption, color: color.textMuted },
  fieldValue: { ...typography.body, color: color.textPrimary, marginTop: 1 },
  mono: { fontFamily: "monospace", fontSize: 12, color: color.textSecondary },
  divider: { height: 1, backgroundColor: color.border, marginHorizontal: spacing.lg },

  chainNote: {
    flexDirection: "row", gap: spacing.md, alignItems: "center",
    backgroundColor: color.primarySoft, borderRadius: radius.md, padding: spacing.lg,
  },
  chainText: { ...typography.caption, color: color.textSecondary, flex: 1, lineHeight: 18 },
});
