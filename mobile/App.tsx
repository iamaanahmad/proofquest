import React, { useEffect } from "react";
import { View, ActivityIndicator, Text, StyleSheet } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { NavigationContainer, DefaultTheme } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import type { RootStackParamList } from "./src/types";
import WelcomeScreen from "./src/screens/WelcomeScreen";
import HomeScreen from "./src/screens/HomeScreen";
import CreateQuestScreen from "./src/screens/CreateQuestScreen";
import QuestDetailScreen from "./src/screens/QuestDetailScreen";
import CaptureScreen from "./src/screens/CaptureScreen";
import ReviewScreen from "./src/screens/ReviewScreen";
import { useWalletStore } from "./src/store/wallet";
import { ensureAppwriteSession } from "./src/lib/appwrite";
import { FeedbackProvider } from "./src/ui";
import { color, spacing, typography } from "./src/theme/tokens";

const Stack = createNativeStackNavigator<RootStackParamList>();

// Match the navigator's background to the app background so there's never a
// white flash between screen transitions.
const navTheme = {
  ...DefaultTheme,
  colors: { ...DefaultTheme.colors, background: color.background },
};

function Splash() {
  return (
    <View style={styles.splash}>
      <View style={styles.mark}>
        <View style={styles.markInner} />
      </View>
      <Text style={styles.wordmark}>ProofQuest</Text>
      <ActivityIndicator color={color.primary} size="small" style={styles.spinner} />
    </View>
  );
}

export default function App() {
  const { authToken, role, hydrated, hydrate } = useWalletStore();

  useEffect(() => {
    hydrate();
    // Warm up the Appwrite anonymous session in the background so it is
    // ready before the user tries to create/update a quest.  Errors here
    // are non-fatal — ensureAppwriteSession() will retry on demand.
    ensureAppwriteSession().catch(() => {});
  }, []);

  if (!hydrated) {
    return (
      <SafeAreaProvider>
        <Splash />
      </SafeAreaProvider>
    );
  }

  const isConnected = !!authToken && !!role;

  return (
    <SafeAreaProvider>
      <FeedbackProvider>
        <NavigationContainer theme={navTheme}>
          <Stack.Navigator
            screenOptions={{ headerShown: false, contentStyle: { backgroundColor: color.background } }}
            initialRouteName={isConnected ? "Home" : "Welcome"}
          >
            <Stack.Screen name="Welcome" component={WelcomeScreen} />
            <Stack.Screen name="Home" component={HomeScreen} />
            <Stack.Screen name="CreateQuest" component={CreateQuestScreen} />
            <Stack.Screen name="QuestDetail" component={QuestDetailScreen} />
            <Stack.Screen name="Capture" component={CaptureScreen} />
            <Stack.Screen name="Review" component={ReviewScreen} />
          </Stack.Navigator>
        </NavigationContainer>
      </FeedbackProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  splash: {
    flex: 1,
    backgroundColor: color.background,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.lg,
  },
  mark: {
    width: 72,
    height: 72,
    borderRadius: 20,
    backgroundColor: color.primarySoft,
    alignItems: "center",
    justifyContent: "center",
  },
  markInner: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 3,
    borderColor: color.primary,
    borderTopColor: color.success,
  },
  wordmark: { ...typography.title, color: color.textPrimary },
  spinner: { marginTop: spacing.sm },
});
