import { Stack } from 'expo-router'

export default function DocsLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: '#7b68ee' },
        headerTintColor: '#fff',
        headerTitleStyle: { fontWeight: '700' },
      }}
    />
  )
}
