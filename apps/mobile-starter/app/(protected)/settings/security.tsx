// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';
const ROWS = [
  { label: 'Change Password', icon: 'lock-closed', route: '/settings/change-password' },
  { label: 'Biometric Login', icon: 'finger-print', route: '/settings/biometric' },
  { label: 'Two-Factor Auth', icon: 'shield-checkmark', route: '/settings/two-factor' },
  { label: 'Active Sessions', icon: 'phone-portrait', route: '/settings/devices' },
  { label: 'Account Activity', icon: 'list', route: '/settings/devices' },
];
export default function SecuritySettings() {
  const router = useRouter();
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}><Pressable style={styles.backBtn} onPress={() => router.back()}><Ionicons name="arrow-back" size={22} color="#fff" /></Pressable><Text style={styles.headerTitle}>Security</Text><View style={{ width: 38 }} /></View>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.card}>{ROWS.map((row,i)=>(
          <Pressable key={i} style={[styles.listRow,i<ROWS.length-1&&styles.listBorder]} onPress={()=>router.push(row.route as never)}>
            <View style={styles.rowIcon}><Ionicons name={row.icon as any} size={18} color={colors.primary.DEFAULT}/></View>
            <Text style={[styles.listTitle,{flex:1}]}>{row.label}</Text>
            <Ionicons name="chevron-forward" size={16} color={colors.neutral.placeholder}/>
          </Pressable>
        ))}</View>
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
  card:{backgroundColor:colors.neutral.surface,borderRadius:16,overflow:'hidden',shadowColor:'#000',shadowOpacity:0.04,elevation:2},
  listRow:{flexDirection:'row',alignItems:'center',gap:12,padding:14},
  listBorder:{borderBottomWidth:1,borderBottomColor:colors.neutral.border},
  listTitle:{fontSize:14,fontWeight:'600',color:colors.neutral.text},
  rowIcon:{width:34,height:34,borderRadius:10,backgroundColor:colors.neutral.surfaceAlt,alignItems:'center',justifyContent:'center'},
});
