import { View, Text, StyleSheet } from 'react-native'
import { Link } from 'expo-router'

export default function NotFoundScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.icon}>🔍</Text>
      <Text style={styles.title}>페이지를 찾을 수 없습니다.</Text>
      <Link href="/(app)" style={styles.link}>홈으로 돌아가기</Link>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  icon: { fontSize: 48, marginBottom: 12 },
  title: { fontSize: 18, color: '#374151', marginBottom: 16 },
  link: { fontSize: 15, color: '#7b68ee', fontWeight: '600' },
})
