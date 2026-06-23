// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';
const MONTHLY = [0.6,0.7,0.65,0.8,0.75,0.9,0.85,0.95,0.88,0.92,0.96,1.0];
const MONTHS = ['J','F','M','A','M','J','J','A','S','O','N','D'];
const ROLES = [{ label: 'Homeowners', pct: 45, color: colors.primary.DEFAULT }, { label: 'Tenants', pct: 38, color: colors.secondary.DEFAULT }, { label: 'Residents', pct: 17, color: colors.secondary.emerald }];
export default function ResidentAnalytics() {
  const router = useRouter();
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}><Pressable style={styles.backBtn} onPress={() => router.back()}><Ionicons name="arrow-back" size={22} color="#fff" /></Pressable><Text style={styles.headerTitle}>Resident Analytics</Text><View style={{ width: 38 }} /></View>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.statsRow}>
          {[{l:'Total',v:'248'},{l:'Active',v:'231'},{l:'Pending',v:'12'},{l:'Defaulters',v:'37'}].map((s,i)=>(
            <View key={i} style={styles.statCard}><Text style={styles.statNum}>{s.v}</Text><Text style={styles.statLabel}>{s.l}</Text></View>
          ))}
        </View>
        <Text style={styles.sectionTitle}>Growth (Monthly)</Text>
        <View style={styles.card}><View style={styles.barChart}>{MONTHLY.map((h,i)=>(
          <View key={i} style={styles.barItem}><View style={styles.barTrack}><View style={[styles.bar,{height:`${h*100}%`}]}/></View><Text style={styles.barLabel}>{MONTHS[i]}</Text></View>
        ))}</View></View>
        <Text style={styles.sectionTitle}>Role Breakdown</Text>
        <View style={styles.card}>{ROLES.map((r,i)=>(
          <View key={i} style={[styles.listRow, i<ROLES.length-1 && styles.listBorder]}>
            <View style={[styles.dot,{backgroundColor:r.color}]}/>
            <Text style={[styles.listTitle,{flex:1}]}>{r.label}</Text>
            <Text style={[styles.pct,{color:r.color}]}>{r.pct}%</Text>
          </View>
        ))}</View>
        <View style={styles.compCard}><Ionicons name="checkmark-circle" size={18} color={colors.secondary.emerald}/><Text style={styles.compText}>Payment Compliance: <Text style={{fontWeight:'800',color:colors.secondary.emerald}}>87%</Text></Text></View>
      </ScrollView>
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  safe:{flex:1,backgroundColor:colors.neutral.background},
  header:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',paddingHorizontal:16,paddingVertical:14,backgroundColor:colors.primary.DEFAULT},
  backBtn:{width:38,height:38,borderRadius:19,backgroundColor:'rgba(255,255,255,0.2)',alignItems:'center',justifyContent:'center'},
  headerTitle:{fontSize:17,fontWeight:'700',color:'#fff'},
  content:{padding:20,gap:16},
  statsRow:{flexDirection:'row',gap:8},
  statCard:{flex:1,backgroundColor:colors.neutral.surface,borderRadius:12,padding:10,alignItems:'center',gap:2},
  statNum:{fontSize:18,fontWeight:'800',color:colors.neutral.text},
  statLabel:{fontSize:10,color:colors.neutral.textMuted,textAlign:'center'},
  sectionTitle:{fontSize:15,fontWeight:'700',color:colors.neutral.text},
  card:{backgroundColor:colors.neutral.surface,borderRadius:16,overflow:'hidden',shadowColor:'#000',shadowOffset:{width:0,height:2},shadowOpacity:0.06,shadowRadius:8,elevation:3},
  barChart:{flexDirection:'row',alignItems:'flex-end',justifyContent:'space-around',height:100,padding:12},
  barItem:{alignItems:'center',gap:4,flex:1},
  barTrack:{width:18,height:80,backgroundColor:colors.neutral.surfaceAlt,borderRadius:4,justifyContent:'flex-end'},
  bar:{width:'100%',backgroundColor:colors.primary.DEFAULT,borderRadius:4},
  barLabel:{fontSize:9,color:colors.neutral.textMuted},
  listRow:{flexDirection:'row',alignItems:'center',gap:10,padding:14},
  listBorder:{borderBottomWidth:1,borderBottomColor:colors.neutral.border},
  listTitle:{fontSize:14,fontWeight:'600',color:colors.neutral.text},
  dot:{width:10,height:10,borderRadius:5},
  pct:{fontSize:15,fontWeight:'800'},
  compCard:{flexDirection:'row',alignItems:'center',gap:10,backgroundColor:colors.secondary.emerald+'15',borderRadius:12,padding:14},
  compText:{fontSize:14,color:colors.neutral.text},
});
