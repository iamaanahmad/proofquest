import React from "react";
import { View, StatusBar, StyleSheet, type ViewStyle, type StyleProp } from "react-native";
import { SafeAreaView, type Edge } from "react-native-safe-area-context";
import { color } from "../theme/tokens";

interface Props {
  children: React.ReactNode;
  edges?: readonly Edge[];
  style?: StyleProp<ViewStyle>;
}

/**
 * Themed screen wrapper: consistent dark background, light status-bar content,
 * and safe-area handling. Keeps every screen's chrome identical.
 */
export default function Screen({ children, edges = ["top", "bottom"], style }: Props) {
  return (
    <SafeAreaView style={[styles.safe, style]} edges={edges}>
      <StatusBar barStyle="light-content" backgroundColor={color.background} />
      {children}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.background },
});

export { View };
