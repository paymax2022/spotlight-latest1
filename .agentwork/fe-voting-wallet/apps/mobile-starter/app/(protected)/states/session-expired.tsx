// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';
export default function SessionExpiredScreen() {
  const router = useRouter();
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.wrap}>
        <View style={styles.iconWrap}><Ionicons name="lock-closed" size={80} color={colors.primary.DEFAULT}/></View>
        <Text style={styles.title}>Session Expired</Text>
        <Text style={styles.sub}>For your security, you have been signed out after a period of inactivity.</Text>
        <Pressable style={styles.btn} onPress={() => router.replace('/(auth)/login' as never)}><Text style={styles.btnText}>Sign In Again</Text></Pressable>
      </View>
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  safe:{flex:1,backgroundColor:colors.neutral.background},
  wrap:{flex:1,alignItems:'center',justifyContent:'center',padding:32,gap:16},
  iconWrap:{width:120,height:120,borderRadius:60,backgroundColor:colors.primary.DEFAULT+'15',alignItems:'center',justifyContent:'center',marginBottom:8},
  title:{fontSize:22,fontWeight:'800',color:colors.neutral.text,textAlign:'center'},
  sub:{fontSize:15,color:colors.neutral.textMuted,textAlign:'center',lineHeight:22},
  btn:{backgroundColor:colors.primary.DEFAULT,borderRadius:14,height:52,paddingHorizontal:32,alignItems:'center',justifyContent:'center'},
  btnText:{color:'#fff',fontSize:16,fontWeight:'700'},
});
