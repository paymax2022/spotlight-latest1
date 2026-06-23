// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';
const MEMBERS = [{name:'James Okonkwo',role:'Spouse'},{name:'Chidi Okonkwo',role:'Child'},{name:'Mrs. Ngozi Eze',role:'Emergency Contact'}];
export default function HouseholdSettings() {
  const router = useRouter();
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}><Pressable style={styles.backBtn} onPress={() => router.back()}><Ionicons name="arrow-back" size={22} color="#fff" /></Pressable><Text style={styles.headerTitle}>Household</Text><Pressable style={styles.backBtn}><Ionicons name="add" size={22} color="#fff" /></Pressable></View>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.sectionTitle}>Household Members</Text>
        <View style={styles.card}>{MEMBERS.map((m,i)=>(
          <View key={i} style={[styles.listRow,i<MEMBERS.length-1&&styles.listBorder]}>
            <View style={styles.avatar}><Text style={styles.avatarText}>{m.name[0]}</Text></View>
            <View style={{flex:1}}><Text style={styles.listTitle}>{m.name}</Text><Text style={styles.listSub}>{m.role}</Text></View>
            <Ionicons name="chevron-forward" size={16} color={colors.neutral.placeholder} />
          </View>
        ))}</View>
        <Text style={styles.sectionTitle}>Emergency Contact</Text>
        <View style={styles.card}><View style={styles.listRow}><Ionicons name="call-outline" size={20} color={colors.secondary.red}/><Text style={[styles.listTitle,{flex:1}]}>Mrs. Ngozi Eze · +234 809 111 2222</Text></View></View>
        <Pressable style={styles.primaryBtn}><Ionicons name="person-add-outline" size={18} color="#fff"/><Text style={styles.primaryBtnText}>Add Member</Text></Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  safe:{flex:1,backgroundColor:colors.neutral.background},
  header:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',paddingHorizontal:16,paddingVertical:14,backgroundColor:colors.primary.DEFAULT},
  backBtn:{width:38,height:38,borderRadius:19,backgroundColor:'rgba(255,255,255,0.2)',alignItems:'center',justifyContent:'center'},
  headerTitle:{fontSize:17,fontWeight:'700',color:'#fff'},
  content:{padding:20,gap:14},
  sectionTitle:{fontSize:13,fontWeight:'700',color:colors.neutral.textMuted,textTransform:'uppercase',letterSpacing:0.5},
  card:{backgroundColor:colors.neutral.surface,borderRadius:16,overflow:'hidden',shadowColor:'#000',shadowOpacity:0.04,elevation:2},
  listRow:{flexDirection:'row',alignItems:'center',gap:12,padding:14},
  listBorder:{borderBottomWidth:1,borderBottomColor:colors.neutral.border},
  avatar:{width:38,height:38,borderRadius:19,backgroundColor:colors.primary.DEFAULT+'20',alignItems:'center',justifyContent:'center'},
  avatarText:{fontSize:14,fontWeight:'700',color:colors.primary.DEFAULT},
  listTitle:{fontSize:14,fontWeight:'600',color:colors.neutral.text},
  listSub:{fontSize:12,color:colors.neutral.textMuted,marginTop:2},
  primaryBtn:{backgroundColor:colors.primary.DEFAULT,borderRadius:14,height:52,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:8},
  primaryBtnText:{color:'#fff',fontSize:16,fontWeight:'700'},
});
