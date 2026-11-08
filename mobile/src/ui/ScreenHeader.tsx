import React from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { color, spacing, typography } from "../theme/tokens";
import Icon from "./Icon";

interface Props {
  title?: string;
  onBack?: () => void;
  right?: React.ReactNode;
}

/**
 * Consistent in-app header: a back affordance (chevron drawn with borders, not
 * an emoji), a centered title, and an optional right-side action. Used across
 * all detail/flow screens so navigation feels predictable.
 */
export default function ScreenHeader({ title, onBack, right }: Props) {
  return (
    <View style={styles.bar}>
      <View style={styles.side}>
        {onBack ? (
          <Pressable
            onPress={onBack}
            accessibilityRole="button"
            accessibilityLabel="Go back"
            hitSlop={10}
            style={({ pressed }) => [styles.backBtn, pressed && styles.pressed]}
          >
            <Icon name="back" size={22} color={color.textPrimary} />
            <Text style={styles.backText}>Back</Text>
          </Pressable>
        ) : null}
      </View>

      {title ? (
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
      ) : (
        <View />
      )}

      <View style={[styles.side, styles.sideRight]}>{right}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: color.border,
  },
  side: { minWidth: 72, justifyContent: "center" },
  sideRight: { alignItems: "flex-end" },
  backBtn: { flexDirection: "row", alignItems: "center", gap: spacing.xs, minHeight: 44 },
  pressed: { opacity: 0.6 },
  backText: { ...typography.body, color: color.textPrimary, fontWeight: "600" },
  title: { ...typography.heading, color: color.textPrimary, flex: 1, textAlign: "center" },
});
