import React, { useState, useEffect } from "react";
import {
  View, Text, Pressable, StyleSheet, ActivityIndicator,
  PermissionsAndroid, Linking,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Camera, useCameraDevice, useCameraPermission, usePhotoOutput } from "react-native-vision-camera";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList, EvidenceManifest } from "../types";
import { useWalletStore } from "../store/wallet";
import { getQuest, updateQuest, insertManifest, uploadEvidence } from "../lib/appwrite";
import { buildManifest, sha256, sha256Bytes, toHex } from "../lib/manifest";
import { buildSubmitTx } from "../lib/transactions";
import { signAndBroadcast } from "../hooks/useMWA";
import { PublicKey } from "@solana/web3.js";
import { Buffer } from "@craftzdog/react-native-buffer";
import Geolocation from "react-native-geolocation-service";
import Geohash from "ngeohash";
import DeviceInfo from "react-native-device-info";
import "react-native-get-random-values";
import { Screen, Button, Icon, useFeedback } from "../ui";
import { color, spacing, radius, typography } from "../theme/tokens";

type Props = NativeStackScreenProps<RootStackParamList, "Capture">;
type Step = "camera" | "uploading" | "submitting" | "done";

/* ── helpers (logic untouched) ── */

async function readFileAsBytes(uri: string): Promise<Uint8Array> {
  const res = await fetch(uri);
  if (typeof res.blob === "function") {
    const blob = await res.blob();
    const dataUrl: string = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error ?? new Error("FileReader failed"));
      reader.readAsDataURL(blob);
    });
    const base64 = dataUrl.includes(",") ? dataUrl.slice(dataUrl.indexOf(",") + 1) : dataUrl;
    return new Uint8Array(Buffer.from(base64, "base64"));
  }
  if (typeof res.arrayBuffer === "function") {
    const ab = await res.arrayBuffer();
    return new Uint8Array(ab);
  }
  throw new Error("No supported method to read file bytes");
}

function randomUUID(): string {
  const bytes = new Uint8Array(16);
  (globalThis as any).crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex: string[] = [];
  for (let i = 0; i < 256; i++) hex.push((i + 0x100).toString(16).slice(1));
  const h = Array.from(bytes, (b) => hex[b]);
  return `${h[0]}${h[1]}${h[2]}${h[3]}-${h[4]}${h[5]}-${h[6]}${h[7]}-${h[8]}${h[9]}-${h[10]}${h[11]}${h[12]}${h[13]}${h[14]}${h[15]}`;
}

async function getLocationWithPermission(): Promise<GeolocationPosition> {
  const granted = await PermissionsAndroid.request(
    PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
    { title: "Location permission", message: "ProofQuest needs your location to tag this evidence.", buttonPositive: "Allow", buttonNegative: "Deny" }
  );
  if (granted !== PermissionsAndroid.RESULTS.GRANTED) throw new Error("Location permission denied");
  return new Promise<GeolocationPosition>((res, rej) =>
    Geolocation.getCurrentPosition(res, rej, { enableHighAccuracy: false, timeout: 10000 })
  );
}

const PROGRESS: { key: Step; label: string; icon: React.ComponentProps<typeof Icon>["name"] }[] = [
  { key: "uploading", label: "Uploading evidence", icon: "refresh" },
  { key: "submitting", label: "Writing proof on-chain", icon: "link" },
  { key: "done", label: "Proof submitted!", icon: "check" },
];

/* ── component ── */

export default function CaptureScreen({ route, navigation }: Props) {
  const { questPublicKey } = route.params;
  const { publicKey } = useWalletStore();
  const { hasPermission, requestPermission } = useCameraPermission();
  const { alert } = useFeedback();
  const device = useCameraDevice("back");
  const photoOutput = usePhotoOutput();
  const [step, setStep] = useState<Step>("camera");
  const [quest, setQuest] = useState<any>(null);

  useEffect(() => { getQuest(questPublicKey).then(setQuest); }, []);

  async function capture() {
    if (!publicKey || !quest) return;
    let stage = "capturePhoto";
    try {
      // CRITICAL: capture BEFORE setStep — swapping UI unmounts <Camera>,
      // closing the session before the photo is taken.
      const photoFile = await photoOutput.capturePhotoToFile({ flashMode: "off" }, {});
      setStep("uploading");

      stage = "readPhotoBytes";
      const photoUri = photoFile.filePath.startsWith("file://") ? photoFile.filePath : `file://${photoFile.filePath}`;
      const photoBytes = await readFileAsBytes(photoUri);
      stage = "sha256";
      const mediaSha256 = toHex(sha256Bytes(photoBytes));

      stage = "location";
      const pos = await getLocationWithPermission();
      const geohash = Geohash.encode(pos.coords.latitude, pos.coords.longitude, 5);

      stage = "upload";
      const uploaded = await uploadEvidence(`${questPublicKey}-${publicKey.toBase58()}-${Date.now()}`, photoUri);

      stage = "manifest";
      const manifest: EvidenceManifest = {
        questAddress: questPublicKey, workerWallet: publicKey.toBase58(),
        captureTimestamp: Math.floor(Date.now() / 1000),
        coarseLocation: { geohash, accuracy: pos.coords.accuracy },
        nonce: randomUUID(), qrChallengeResult: null,
        mediaSha256, storageObjectId: uploaded.$id,
        appVersion: DeviceInfo.getVersion(),
      };
      const manifestJson = buildManifest(manifest);
      const manifestHash = sha256(manifestJson);

      stage = "insertManifest";
      await insertManifest({ quest_public_key: questPublicKey, worker: publicKey.toBase58(), manifest: manifestJson, manifest_hash: toHex(manifestHash) });

      setStep("submitting");
      stage = "submitTx";
      const tx = await buildSubmitTx(new PublicKey(quest.creator), BigInt(quest.quest_id), publicKey, Array.from(manifestHash));
      await signAndBroadcast(tx);
      await updateQuest(questPublicKey, { status: "submitted", evidence_manifest_hash: toHex(manifestHash), submitted_at: new Date().toISOString() });

      setStep("done");
      setTimeout(() => navigation.navigate("Home"), 2200);
    } catch (e: any) {
      setStep("camera");
      if (e.message !== "Location permission denied") {
        await alert({ title: "Capture failed", message: `[${stage}] ${e?.message ?? String(e)}`, tone: "danger" });
      }
    }
  }

  /* ── permission screen ── */
  if (!hasPermission || !device) {
    return (
      <Screen>
        <View style={styles.center}>
          <Icon name="camera" size={56} color={color.textMuted} />
          <Text style={styles.permTitle}>Camera access needed</Text>
          <Text style={styles.permDesc}>Grant camera permission to capture evidence.</Text>
          <Button label="Grant permission" variant="primary" onPress={requestPermission} />
          <Pressable onPress={() => navigation.goBack()} hitSlop={12}
            accessibilityRole="button" accessibilityLabel="Cancel">
            <Text style={styles.cancelLink}>Cancel</Text>
          </Pressable>
        </View>
      </Screen>
    );
  }

  /* ── progress screen ── */
  if (step !== "camera") {
    const idx = PROGRESS.findIndex((s) => s.key === step);
    return (
      <Screen>
        <View style={styles.center}>
          {step === "done" ? (
            <View style={styles.doneRing}>
              <Icon name="check" size={32} color={color.success} />
            </View>
          ) : (
            <ActivityIndicator color={color.primary} size="large" />
          )}
          <Text style={styles.progressTitle}>{PROGRESS[idx]?.label}</Text>

          <View style={styles.steps}>
            {PROGRESS.map((s, i) => {
              const active = i <= idx;
              return (
                <View key={s.key} style={styles.stepRow}>
                  <View style={[styles.stepDot, active && styles.stepDotActive]}>
                    <Icon name={s.icon} size={14} color={active ? color.onAccent : color.textFaint} />
                  </View>
                  <Text style={[styles.stepLabel, active && styles.stepLabelActive]}>{s.label}</Text>
                </View>
              );
            })}
          </View>
        </View>
      </Screen>
    );
  }

  /* ── camera screen ── */
  return (
    <View style={styles.cameraWrap}>
      <Camera style={StyleSheet.absoluteFill} device={device} isActive outputs={[photoOutput]} />

      <SafeAreaView style={styles.topBar} edges={["top"]}>
        <Pressable style={styles.closeBtn} onPress={() => navigation.goBack()}
          accessibilityRole="button" accessibilityLabel="Close camera">
          <Icon name="close" size={18} color={color.white} />
        </Pressable>
        <View style={styles.liveBadge}>
          <View style={styles.liveDot} />
          <Text style={styles.liveText}>GPS + timestamp auto-captured</Text>
        </View>
      </SafeAreaView>

      {/* Viewfinder corners */}
      <View style={styles.vf}>
        <View style={[styles.vfC, styles.vfTL]} />
        <View style={[styles.vfC, styles.vfTR]} />
        <View style={[styles.vfC, styles.vfBL]} />
        <View style={[styles.vfC, styles.vfBR]} />
      </View>

      {/* Bottom bar */}
      <View style={styles.bottomBar}>
        <Text style={styles.hint}>Frame the evidence clearly</Text>
        <Pressable style={({ pressed }) => [styles.shutter, pressed && styles.shutterPressed]} onPress={capture}
          accessibilityRole="button" accessibilityLabel="Capture photo">
          <View style={styles.shutterInner} />
        </Pressable>
        <Text style={styles.hintSub}>Tap to capture & submit proof</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xxxl, gap: spacing.md },

  permTitle: { ...typography.title, color: color.textPrimary, marginTop: spacing.lg },
  permDesc: { ...typography.body, color: color.textMuted, textAlign: "center" },
  cancelLink: { ...typography.label, color: color.textMuted, marginTop: spacing.sm },

  doneRing: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: color.successSoft, borderWidth: 2, borderColor: color.success,
    alignItems: "center", justifyContent: "center",
  },
  progressTitle: { ...typography.title, color: color.textPrimary, textAlign: "center" },
  steps: { marginTop: spacing.huge, gap: spacing.lg, width: "100%" },
  stepRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  stepDot: {
    width: 30, height: 30, borderRadius: 15, backgroundColor: color.surfaceHigh,
    alignItems: "center", justifyContent: "center",
  },
  stepDotActive: { backgroundColor: color.primary },
  stepLabel: { ...typography.body, color: color.textFaint },
  stepLabelActive: { color: color.textPrimary, fontWeight: "700" },

  cameraWrap: { flex: 1, backgroundColor: "#000" },
  topBar: {
    position: "absolute", top: 0, left: 0, right: 0, zIndex: 10,
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingHorizontal: spacing.xl, paddingTop: spacing.sm,
  },
  closeBtn: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(0,0,0,0.5)",
    alignItems: "center", justifyContent: "center",
  },
  liveBadge: {
    flexDirection: "row", alignItems: "center", gap: spacing.xs + 2,
    backgroundColor: "rgba(0,0,0,0.5)", borderRadius: radius.pill,
    paddingHorizontal: spacing.md, paddingVertical: spacing.xs + 1,
  },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: color.success },
  liveText: { ...typography.caption, color: color.white },

  vf: { position: "absolute", top: "25%", left: "10%", right: "10%", bottom: "25%" },
  vfC: { position: "absolute", width: 28, height: 28, borderColor: "#fff", borderWidth: 2.5 },
  vfTL: { top: 0, left: 0, borderRightWidth: 0, borderBottomWidth: 0, borderTopLeftRadius: 4 },
  vfTR: { top: 0, right: 0, borderLeftWidth: 0, borderBottomWidth: 0, borderTopRightRadius: 4 },
  vfBL: { bottom: 0, left: 0, borderRightWidth: 0, borderTopWidth: 0, borderBottomLeftRadius: 4 },
  vfBR: { bottom: 0, right: 0, borderLeftWidth: 0, borderTopWidth: 0, borderBottomRightRadius: 4 },

  bottomBar: {
    position: "absolute", bottom: 0, left: 0, right: 0,
    paddingBottom: spacing.huge, paddingTop: spacing.xxl, alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.55)",
  },
  hint: { ...typography.body, color: color.white, marginBottom: spacing.xl },
  shutter: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: "rgba(255,255,255,0.12)", borderWidth: 3, borderColor: "#fff",
    alignItems: "center", justifyContent: "center",
  },
  shutterPressed: { opacity: 0.7, transform: [{ scale: 0.96 }] },
  shutterInner: { width: 62, height: 62, borderRadius: 31, backgroundColor: "#fff" },
  hintSub: { ...typography.caption, color: "rgba(255,255,255,0.55)", marginTop: spacing.md },
});
