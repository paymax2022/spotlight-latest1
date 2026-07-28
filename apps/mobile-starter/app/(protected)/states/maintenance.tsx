// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';
export default function MaintenanceScreen() {
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.wrap}>
        <View style={styles.iconWrap}><Ionicons name="construct" size={80} color={colors.secondary.amber}/></View>
        <Text style={styles.title}>System Maintenance</Text>
        <Text style={styles.sub}>We are performing scheduled maintenance to improve your experience. We will be back shortly.</Text>
        <View style={styles.etaCard}><Ionicons name="time-outline" size={18} color={colors.secondary.amber}/><Text style={styles.etaText}>Estimated completion: 2–4 hours</Text></View>
      </View>
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  safe:{flex:1,backgroundColor:colors.neutral.background},
  wrap:{flex:1,alignItems:'center',justifyContent:'center',padding:32,gap:16},
  iconWrap:{width:120,height:120,borderRadius:60,backgroundColor:colors.secondary.amber+'20',alignItems:'center',justifyContent:'center',marginBottom:8},
  title:{fontSize:22,fontWeight:'800',color:colors.neutral.text,textAlign:'center'},
  sub:{fontSize:15,color:colors.neutral.textMuted,textAlign:'center',lineHeight:22},
  etaCard:{flexDirection:'row',alignItems:'center',gap:8,backgroundColor:colors.secondary.amber+'15',borderRadius:12,paddingHorizontal:16,paddingVertical:10},
  etaText:{fontSize:13,fontWeight:'600',color:colors.secondary.amber},
});
