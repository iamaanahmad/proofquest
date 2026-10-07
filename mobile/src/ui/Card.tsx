import React from "react";
import { View, Pressable, StyleSheet, type ViewStyle, type StyleProp } from "react-native";
import { color, radius, spacing } from "../theme/tokens";

interface Props {
  children: React.ReactNode;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  padded?: boolean;
  accessibilityLabel?: string;
}

/**
 * Elevated surface used to group related content. A single hairline border and
 * a slightly raised surface create separation without the heavy "card around
 * everything with glowing borders" look.
 */
export default function Card({ children, onPress, style, padded = true, accessibilityLabel }: Props) {
  const content = (
    <View style={[styles.card, padded && styles.padded, style]}>{children}</View>
  );

  if (!onPress) return content;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [pressed && styles.pressed]}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: color.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: color.border,
  },
  padded: { padding: spacing.lg },
  pressed: { opacity: 0.9 },
});
