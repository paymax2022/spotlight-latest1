// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';
export default function UpdateRequired() {
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.wrap}>
        <View style={styles.iconWrap}><Ionicons name="download" size={80} color={colors.secondary.DEFAULT}/></View>
        <Text style={styles.title}>Update Available</Text>
        <Text style={styles.sub}>A new version of Paymax is required to continue. Please update to access all features.</Text>
        <Pressable style={styles.btn} onPress={() => Linking.openURL('https://apps.apple.com')}><Ionicons name="download-outline" size={18} color="#fff"/><Text style={styles.btnText}>Update Now</Text></Pressable>
      </View>
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  safe:{flex:1,backgroundColor:colors.neutral.background},
  wrap:{flex:1,alignItems:'center',justifyContent:'center',padding:32,gap:16},
  iconWrap:{width:120,height:120,borderRadius:60,backgroundColor:colors.secondary.DEFAULT+'15',alignItems:'center',justifyContent:'center',marginBottom:8},
  title:{fontSize:22,fontWeight:'800',color:colors.neutral.text,textAlign:'center'},
  sub:{fontSize:15,color:colors.neutral.textMuted,textAlign:'center',lineHeight:22},
  btn:{backgroundColor:colors.secondary.DEFAULT,borderRadius:14,height:52,paddingHorizontal:32,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:8},
  btnText:{color:'#fff',fontSize:16,fontWeight:'700'},
});
