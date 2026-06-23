// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';
export default function LogoutScreen() {
  const router = useRouter();
  const handleLogout = () => {
    // Clear storage here in real implementation
    router.replace('/(auth)/login' as never);
  };
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        <View style={styles.iconWrap}><Ionicons name="log-out" size={60} color={colors.secondary.red}/></View>
        <Text style={styles.title}>Sign Out?</Text>
        <Text style={styles.subtitle}>Are you sure you want to sign out of your account?</Text>
        <Pressable style={styles.dangerBtn} onPress={handleLogout}>
          <Ionicons name="log-out" size={18} color="#fff"/>
          <Text style={styles.dangerBtnText}>Yes, Sign Out</Text>
        </Pressable>
        <Pressable style={styles.cancelBtn} onPress={() => router.back()}>
          <Text style={styles.cancelBtnText}>Cancel</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  safe:{flex:1,backgroundColor:colors.neutral.background},
  container:{flex:1,alignItems:'center',justifyContent:'center',padding:32,gap:16},
  iconWrap:{width:100,height:100,borderRadius:50,backgroundColor:colors.secondary.red+'15',alignItems:'center',justifyContent:'center',marginBottom:8},
  title:{fontSize:24,fontWeight:'800',color:colors.neutral.text},
  subtitle:{fontSize:15,color:colors.neutral.textMuted,textAlign:'center',lineHeight:22},
  dangerBtn:{backgroundColor:colors.secondary.red,borderRadius:14,height:52,width:'100%',flexDirection:'row',alignItems:'center',justifyContent:'center',gap:8},
  dangerBtnText:{color:'#fff',fontSize:16,fontWeight:'700'},
  cancelBtn:{height:52,width:'100%',borderRadius:14,alignItems:'center',justifyContent:'center',borderWidth:1.5,borderColor:colors.neutral.border},
  cancelBtnText:{fontSize:16,fontWeight:'700',color:colors.neutral.text},
});
