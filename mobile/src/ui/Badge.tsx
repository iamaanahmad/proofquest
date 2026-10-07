import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { radius, spacing, typography, statusMeta, type QuestStatusKey } from "../theme/tokens";

interface StatusBadgeProps {
  status: string;
}

/**
 * Quest status badge. Meaning is carried by the LABEL (text), not color alone —
 * the small dot is a secondary cue. Unknown statuses degrade gracefully.
 */
export function StatusBadge({ status }: StatusBadgeProps) {
  const meta = statusMeta[status as QuestStatusKey] ?? {
    label: status ? status[0].toUpperCase() + status.slice(1) : "Unknown",
    fg: "#A6A6C4",
    bg: "#15152E",
  };

  return (
    <View
      style={[styles.badge, { backgroundColor: meta.bg }]}
      accessibilityRole="text"
      accessibilityLabel={`Status: ${meta.label}`}
    >
      <View style={[styles.dot, { backgroundColor: meta.fg }]} />
      <Text style={[styles.label, { color: meta.fg }]}>{meta.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs + 2,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 1,
    alignSelf: "flex-start",
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
  label: { ...typography.caption, fontWeight: "700" },
});
