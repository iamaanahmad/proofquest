import React, { useRef, useState, useEffect } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  PermissionsAndroid,
} from "react-native";
import { Camera, useCameraDevice, useCameraPermission } from "react-native-vision-camera";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList, EvidenceManifest } from "../types";
import { useWalletStore } from "../store/wallet";
import { getQuest, updateQuest, insertManifest, uploadEvidence } from "../lib/appwrite";
import { buildManifest, sha256, sha256Bytes, toHex } from "../lib/manifest";
import { buildSubmitTx } from "../lib/transactions";
import { PublicKey } from "@solana/web3.js";
import { transact } from "@solana-mobile/mobile-wallet-adapter-protocol-web3js";
import Geolocation from "react-native-geolocation-service";
import Geohash from "ngeohash";
import DeviceInfo from "react-native-device-info";
import "react-native-get-random-values";

type Props = NativeStackScreenProps<RootStackParamList, "Capture">;
type Step = "camera" | "uploading" | "submitting" | "done";

export default function CaptureScreen({ route, navigation }: Props) {
  const { questPublicKey } = route.params;
  const { publicKey } = useWalletStore();
  const { hasPermission, requestPermission } = useCameraPermission();
  const device = useCameraDevice("back");
  const camera = useRef<Camera>(null);
  const [step, setStep] = useState<Step>("camera");
  const [quest, setQuest] = useState<any>(null);

  useEffect(() => {
    if (!hasPermission) requestPermission();
    PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION);
    getQuest(questPublicKey).then(setQuest);
  }, []);

  async function capture() {
    if (!camera.current || !publicKey || !quest) return;
    setStep("uploading");

    try {
      // 1. Take photo (in-app only)
      const photo = await camera.current.takePhoto({ flash: "off" });
      const photoBytes = await fetch(`file://${photo.path}`).then((r) => r.arrayBuffer());
      const mediaSha256 = toHex(sha256Bytes(new Uint8Array(photoBytes)));

      // 2. Coarse location
      const pos = await new Promise<GeolocationPosition>((res, rej) =>
        Geolocation.getCurrentPosition(res, rej, { enableHighAccuracy: false, timeout: 8000 })
      );
      const geohash = Geohash.encode(pos.coords.latitude, pos.coords.longitude, 5);

      // 3. Upload to Appwrite storage (private bucket)
      const uploaded = await uploadEvidence(
        `${questPublicKey}-${publicKey.toBase58()}-${Date.now()}`,
        new Uint8Array(photoBytes)
      );

      // 4. Build canonical manifest
      const manifest: EvidenceManifest = {
        questAddress: questPublicKey,
        workerWallet: publicKey.toBase58(),
        captureTimestamp: Math.floor(Date.now() / 1000),
        coarseLocation: { geohash, accuracy: pos.coords.accuracy },
        nonce: crypto.randomUUID(),
        qrChallengeResult: null,
        mediaSha256,
        storageObjectId: uploaded.$id,
        appVersion: DeviceInfo.getVersion(),
      };
      const manifestJson = buildManifest(manifest);
      const manifestHash = sha256(manifestJson);

      // 5. Store manifest in Appwrite DB (private collection)
      await insertManifest({
        quest_public_key: questPublicKey,
        worker: publicKey.toBase58(),
        manifest: manifestJson,
        manifest_hash: toHex(manifestHash),
      });

      setStep("submitting");

      // 6. Write 32-byte digest on-chain
      const tx = await buildSubmitTx(
        new PublicKey(quest.creator),
        BigInt(quest.quest_id),
        publicKey,
        Array.from(manifestHash)
      );
      await transact(async (wallet) => {
        await wallet.signAndSendTransactions({ transactions: [tx] });
      });

      // 7. Update quest status in Appwrite
      await updateQuest(questPublicKey, {
        status: "submitted",
        evidence_manifest_hash: toHex(manifestHash),
        submitted_at: new Date().toISOString(),
      });

      setStep("done");
      Alert.alert("Submitted!", "Your proof is on-chain. Waiting for approval.", [
        { text: "OK", onPress: () => navigation.navigate("Home") },
      ]);
    } catch (e: any) {
      setStep("camera");
      Alert.alert("Capture failed", e.message);
    }
  }

  if (!device || !hasPermission) {
    return (
      <View style={styles.center}>
        <Text style={styles.msg}>Camera permission required</Text>
      </View>
    );
  }

  if (step !== "camera") {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#9945FF" />
        <Text style={styles.msg}>
          {step === "uploading" && "Uploading evidence…"}
          {step === "submitting" && "Writing proof on-chain…"}
          {step === "done" && "Done!"}
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Camera ref={camera} style={StyleSheet.absoluteFill} device={device} isActive photo />
      <View style={styles.overlay}>
        <Text style={styles.hint}>
          Frame the evidence clearly.{"\n"}Location and time are captured automatically.
        </Text>
        <TouchableOpacity style={styles.shutter} onPress={capture} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000" },
  center: { flex: 1, backgroundColor: "#0f0f23", alignItems: "center", justifyContent: "center" },
  msg: { color: "#fff", marginTop: 16, fontSize: 16 },
  overlay: {
    position: "absolute", bottom: 0, left: 0, right: 0,
    padding: 32, alignItems: "center", backgroundColor: "rgba(0,0,0,0.4)",
  },
  hint: { color: "#fff", textAlign: "center", marginBottom: 24, fontSize: 14 },
  shutter: { width: 72, height: 72, borderRadius: 36, backgroundColor: "#fff", borderWidth: 4, borderColor: "#9945FF" },
});
