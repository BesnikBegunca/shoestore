import { Tabs } from "expo-router";
import React from "react";
import { Platform, StyleSheet, Text, View } from "react-native";

import { HapticTab } from "@/components/haptic-tab";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { Colors } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";

export default function TabLayout() {
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme ?? "light"];

  return (
    <Tabs
      screenOptions={{
        headerShown: false,

        // keep your haptic tab
        tabBarButton: HapticTab,

        // hide default label (we render our own)
        tabBarShowLabel: false,

        // ✅ Floating "pill" tab bar
        tabBarStyle: [
          styles.tabBar,
          {
            backgroundColor: "rgba(15, 18, 32, 0.86)",
            borderTopColor: "rgba(255,255,255,0.08)",
          },
        ],

        // little nicer on Android
        tabBarHideOnKeyboard: true,
      }}
    >

      <Tabs.Screen
        name="products"
        options={{
          title: "Products",
          tabBarIcon: ({ focused }) => (
            <TabIcon
              focused={focused}
              label="Products"
              icon={focused ? "tag.fill" : "tag"}
              tint={theme.tint}
            />
          ),
        }}
      />
      <Tabs.Screen
  name="admin"
  options={{
    title: "Admin",
    tabBarIcon: ({ color }) => <IconSymbol size={28} name="gearshape.fill" color={color} />
  }}
/>


    </Tabs>
  );
}

function TabIcon({
  focused,
  label,
  icon,
  tint,
}: {
  focused: boolean;
  label: string;
  icon: any;
  tint: string;
}) {
  return (
    <View style={[styles.item, focused ? [styles.itemActive, { backgroundColor: tint }] : null]}>
      <IconSymbol size={22} name={icon} color={focused ? "#0B0F14" : "rgba(229,231,235,0.85)"} />
      <Text style={[styles.label, { color: focused ? "#0B0F14" : "rgba(229,231,235,0.72)" }]}>
        {label}
      </Text>
      {/* small “dot” indicator */}
      {focused ? <View style={styles.dot} /> : <View style={styles.dotGhost} />}
    </View>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    position: "absolute",
    left: 16,
    right: 16,
    bottom: Platform.select({ ios: 18, android: 14, default: 14 }),
    height: 72,
    borderRadius: 22,
    borderTopWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 10,

    // Shadow
    shadowColor: "#000",
    shadowOpacity: 0.22,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 10,
  },

  item: {
    flex: 1,
    height: 52,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    transform: [{ translateY: 0 }],
  },
  itemActive: {
    transform: [{ translateY: -2 }],
  },

  label: {
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 0.2,
  },

  dot: {
    marginTop: 2,
    width: 6,
    height: 6,
    borderRadius: 99,
    backgroundColor: "rgba(0,0,0,0.35)",
  },
  dotGhost: {
    marginTop: 2,
    width: 6,
    height: 6,
    borderRadius: 99,
    backgroundColor: "transparent",
  },
});
