import React from "react";
import {
  Pressable, Text, ActivityIndicator, StyleSheet, View,
  type ViewStyle, type StyleProp,
} from "react-native";
import { color, radius, spacing, typography } from "../theme/tokens";

type Variant = "primary" | "success" | "secondary" | "destructive" | "ghost";
type Size = "md" | "lg";

interface Props {
  label: string;
  onPress: () => void;
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityHint?: string;
}

const FILL: Record<Variant, { bg: string; fg: string; border?: string }> = {
  primary: { bg: color.primary, fg: color.onAccent },
  success: { bg: color.success, fg: color.onAccent },
  secondary: { bg: color.surfaceHigh, fg: color.textPrimary, border: color.borderStrong },
  destructive: { bg: "transparent", fg: color.danger, border: color.danger },
  ghost: { bg: "transparent", fg: color.textSecondary },
};

/**
 * Primary action control. Comfortable ≥48px touch target, clear pressed /
 * disabled / loading states, and a role/label for screen readers.
 */
export default function Button({
  label, onPress, variant = "primary", size = "lg",
  loading = false, disabled = false, style, accessibilityHint,
}: Props) {
  const fill = FILL[variant];
  const isDisabled = disabled || loading;

  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      style={({ pressed }) => [
        styles.base,
        size === "lg" ? styles.lg : styles.md,
        { backgroundColor: fill.bg },
        fill.border ? { borderWidth: 1, borderColor: fill.border } : null,
        pressed && !isDisabled ? styles.pressed : null,
        isDisabled ? styles.disabled : null,
        style,
      ]}
    >
      <View style={styles.inner}>
        {loading ? (
          <ActivityIndicator color={fill.fg} size="small" />
        ) : (
          <Text style={[styles.label, { color: fill.fg }]} numberOfLines={1}>
            {label}
          </Text>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { borderRadius: radius.md, alignItems: "center", justifyContent: "center" },
  md: { minHeight: 44, paddingVertical: spacing.sm, paddingHorizontal: spacing.lg },
  lg: { minHeight: 52, paddingVertical: spacing.md, paddingHorizontal: spacing.xl },
  inner: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  label: { ...typography.bodyStrong },
  pressed: { opacity: 0.82, transform: [{ scale: 0.99 }] },
  disabled: { opacity: 0.45 },
});
