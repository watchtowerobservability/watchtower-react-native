// Minimal app: `npx expo install @watchtowerobservability/react-native`, replace App.js with this file.
import React from 'react';
import { Button, Text, View } from 'react-native';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import * as wt from '@watchtowerobservability/react-native';

wt.init({ key: 'wtp_your_publishable_key', endpoint: 'https://edge.example.com', service: 'rn-example', release: '1.0.0' });

const ref = createNavigationContainerRef();
const Stack = createNativeStackNavigator();

function Home({ navigation }) {
  return (
    <View style={{ flex: 1, justifyContent: 'center' }}>
      <Text>Watchtower example</Text>
      <Button title="Details" testID="details-btn" onPress={() => navigation.navigate('Details')} />
      <Button title="Throw" testID="throw-btn" onPress={() => wt.captureException(new Error('example error'))} />
    </View>
  );
}

const Details = wt.withRenderSpan(() => <Text>Details</Text>, 'Details');

export default function App() {
  const nav = React.useMemo(() => wt.instrumentNavigation(ref), []);
  return (
    <wt.WatchtowerTouchBoundary>
      <NavigationContainer ref={ref} onReady={nav.onReady}>
        <Stack.Navigator>
          <Stack.Screen name="Home" component={Home} />
          <Stack.Screen name="Details" component={Details} />
        </Stack.Navigator>
      </NavigationContainer>
    </wt.WatchtowerTouchBoundary>
  );
}
