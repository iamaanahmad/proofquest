import React, { createContext, useContext, useCallback, useRef, useState } from "react";
import {
  View, Text, Modal, Pressable, StyleSheet, Animated, Easing,
  AccessibilityInfo,
} from "react-native";
import { color, radius, spacing, typography, elevation } from "../theme/tokens";
import Button from "./Button";
import Icon, { type IconName } from "./Icon";

/* ------------------------------------------------------------------ *
 * Types
 * ------------------------------------------------------------------ */

type Tone = "default" | "success" | "warning" | "danger";

interface DialogOptions {
  title: string;
  message?: string;
  tone?: Tone;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}

interface ToastOptions {
  message: string;
  tone?: Tone;
  duration?: number;
}

interface FeedbackApi {
  /** Styled replacement for Alert.alert with one OK button. Resolves when dismissed. */
  alert: (opts: Omit<DialogOptions, "cancelLabel">) => Promise<void>;
  /** Confirm dialog. Resolves true if confirmed, false if cancelled/dismissed. */
  confirm: (opts: DialogOptions) => Promise<boolean>;
  /** Transient snackbar at the bottom. */
  toast: (opts: ToastOptions) => void;
}

const FeedbackContext = createContext<FeedbackApi | null>(null);

export function useFeedback(): FeedbackApi {
  const ctx = useContext(FeedbackContext);
  if (!ctx) throw new Error("useFeedback must be used within <FeedbackProvider>");
  return ctx;
}

const TONE_FG: Record<Tone, string> = {
  default: color.primary,
  success: color.success,
  warning: color.warning,
  danger: color.danger,
};

const TONE_ICON: Record<Tone, IconName> = {
  default: "alert",
  success: "check",
  warning: "alert",
  danger: "alert",
};

/* ------------------------------------------------------------------ *
 * Provider
 * ------------------------------------------------------------------ */

interface DialogState extends DialogOptions {
  mode: "alert" | "confirm";
  resolve: (v: boolean) => void;
}

export function FeedbackProvider({ children }: { children: React.ReactNode }) {
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [toastState, setToastState] = useState<ToastOptions | null>(null);
  const toastAnim = useRef(new Animated.Value(0)).current;
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const alert = useCallback<FeedbackApi["alert"]>((opts) => {
    return new Promise<void>((resolve) => {
      setDialog({ ...opts, mode: "alert", resolve: () => resolve() });
    });
  }, []);

  const confirm = useCallback<FeedbackApi["confirm"]>((opts) => {
    return new Promise<boolean>((resolve) => {
      setDialog({ ...opts, mode: "confirm", resolve });
    });
  }, []);

  const hideToast = useCallback(() => {
    Animated.timing(toastAnim, {
      toValue: 0, duration: 180, easing: Easing.in(Easing.quad), useNativeDriver: true,
    }).start(() => setToastState(null));
  }, [toastAnim]);

  const toast = useCallback<FeedbackApi["toast"]>((opts) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToastState(opts);
    AccessibilityInfo.announceForAccessibility?.(opts.message);
    Animated.timing(toastAnim, {
      toValue: 1, duration: 220, easing: Easing.out(Easing.quad), useNativeDriver: true,
    }).start();
    toastTimer.current = setTimeout(hideToast, opts.duration ?? 2600);
  }, [toastAnim, hideToast]);

  const settle = (value: boolean) => {
    dialog?.resolve(value);
    setDialog(null);
  };

  const toneFg = dialog ? TONE_FG[dialog.tone ?? "default"] : color.primary;

  return (
    <FeedbackContext.Provider value={{ alert, confirm, toast }}>
      {children}

      {/* Dialog */}
      <Modal
        visible={!!dialog}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => settle(false)}
      >
        <Pressable style={styles.scrim} onPress={() => settle(false)}>
          <Pressable style={styles.dialog} onPress={() => {}}>
            <View style={[styles.toneBar, { backgroundColor: toneFg }]} />
            <View style={styles.dialogBody}>
              <View style={styles.dialogHeader}>
                <View style={[styles.dialogIcon, { backgroundColor: toneFg + "18" }]}>
                  <Icon name={TONE_ICON[dialog?.tone ?? "default"]} size={24} color={toneFg} />
                </View>
                <Text style={styles.dialogTitle}>{dialog?.title}</Text>
              </View>
              {dialog?.message ? (
                <Text style={styles.dialogMessage}>{dialog.message}</Text>
              ) : null}

              <View style={styles.actions}>
                {dialog?.mode === "confirm" ? (
                  <Button
                    label={dialog.cancelLabel ?? "Cancel"}
                    variant="secondary"
                    size="md"
                    onPress={() => settle(false)}
                    style={styles.actionBtn}
                  />
                ) : null}
                <Button
                  label={dialog?.confirmLabel ?? "OK"}
                  variant={dialog?.destructive ? "destructive" : "primary"}
                  size="md"
                  onPress={() => settle(true)}
                  style={styles.actionBtn}
                />
              </View>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Toast */}
      {toastState ? (
        <Animated.View
          pointerEvents="box-none"
          style={[
            styles.toastWrap,
            {
              opacity: toastAnim,
              transform: [
                { translateY: toastAnim.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) },
              ],
            },
          ]}
        >
          <View style={styles.toast} accessibilityLiveRegion="polite">
            <View
              style={[styles.toastAccent, { backgroundColor: TONE_FG[toastState.tone ?? "default"] }]}
            />
            <Text style={styles.toastText}>{toastState.message}</Text>
          </View>
        </Animated.View>
      ) : null}
    </FeedbackContext.Provider>
  );
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    backgroundColor: color.overlay,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xxl,
  },
  dialog: {
    width: "100%",
    maxWidth: 400,
    backgroundColor: color.surfaceAlt,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: color.border,
    overflow: "hidden",
    ...elevation.modal,
  },
  toneBar: { height: 3, width: "100%" },
  dialogBody: { padding: spacing.xl },
  dialogHeader: { flexDirection: "row", alignItems: "center", gap: spacing.md, marginBottom: spacing.sm },
  dialogIcon: { width: 40, height: 40, borderRadius: radius.md, alignItems: "center", justifyContent: "center" },
  dialogTitle: { ...typography.heading, color: color.textPrimary, flex: 1 },
  dialogMessage: { ...typography.body, color: color.textSecondary, marginBottom: spacing.xl },
  actions: { flexDirection: "row", gap: spacing.sm, justifyContent: "flex-end" },
  actionBtn: { minWidth: 96 },

  toastWrap: {
    position: "absolute",
    left: spacing.lg,
    right: spacing.lg,
    bottom: spacing.xxxl,
    alignItems: "center",
  },
  toast: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: color.surfaceHigh,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.border,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    maxWidth: 440,
    ...elevation.card,
  },
  toastAccent: { width: 4, alignSelf: "stretch", borderRadius: 2 },
  toastText: { ...typography.body, color: color.textPrimary, flex: 1 },
});
