import React from "react";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import type { RootStackParamList } from "./src/types";
import WelcomeScreen from "./src/screens/WelcomeScreen";
import HomeScreen from "./src/screens/HomeScreen";
import CreateQuestScreen from "./src/screens/CreateQuestScreen";
import QuestDetailScreen from "./src/screens/QuestDetailScreen";
import CaptureScreen from "./src/screens/CaptureScreen";
import ReviewScreen from "./src/screens/ReviewScreen";
import { useWalletStore } from "./src/store/wallet";

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function App() {
  const { publicKey } = useWalletStore();

  return (
    <NavigationContainer>
      <Stack.Navigator
        screenOptions={{ headerShown: false }}
        initialRouteName={publicKey ? "Home" : "Welcome"}
      >
        <Stack.Screen name="Welcome" component={WelcomeScreen} />
        <Stack.Screen name="Home" component={HomeScreen} />
        <Stack.Screen name="CreateQuest" component={CreateQuestScreen} />
        <Stack.Screen name="QuestDetail" component={QuestDetailScreen} />
        <Stack.Screen name="Capture" component={CaptureScreen} />
        <Stack.Screen name="Review" component={ReviewScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
