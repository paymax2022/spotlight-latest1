// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';
export default function ServerErrorScreen() {
  const router = useRouter();
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.wrap}>
        <View style={styles.iconWrap}><Ionicons name="cloud-offline" size={80} color={colors.secondary.red}/></View>
        <Text style={styles.title}>Something Went Wrong</Text>
        <Text style={styles.errorCode}>Error 500</Text>
        <Text style={styles.sub}>We are working to fix this. Please try again shortly.</Text>
        <Pressable style={styles.btn} onPress={() => router.back()}><Text style={styles.btnText}>Try Again</Text></Pressable>
      </View>
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  safe:{flex:1,backgroundColor:colors.neutral.background},
  wrap:{flex:1,alignItems:'center',justifyContent:'center',padding:32,gap:14},
  iconWrap:{width:120,height:120,borderRadius:60,backgroundColor:colors.secondary.red+'15',alignItems:'center',justifyContent:'center',marginBottom:8},
  title:{fontSize:22,fontWeight:'800',color:colors.neutral.text,textAlign:'center'},
  errorCode:{fontSize:13,color:colors.neutral.placeholder,fontWeight:'600'},
  sub:{fontSize:15,color:colors.neutral.textMuted,textAlign:'center',lineHeight:22},
  btn:{backgroundColor:colors.primary.DEFAULT,borderRadius:14,height:52,paddingHorizontal:32,alignItems:'center',justifyContent:'center'},
  btnText:{color:'#fff',fontSize:16,fontWeight:'700'},
});
