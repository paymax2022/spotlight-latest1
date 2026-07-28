// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';
const CATEGORIES = ['General','Payments','Technical','Account','Visitors'];
export default function ContactSupport() {
  const router = useRouter();
  const [cat, setCat] = useState('General');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [submitted, setSubmitted] = useState('');
  const submit = () => setSubmitted('TKT-' + Math.floor(10000 + Math.random() * 90000));
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}><Pressable style={styles.backBtn} onPress={() => router.back()}><Ionicons name="arrow-back" size={22} color="#fff" /></Pressable><Text style={styles.headerTitle}>Contact Support</Text><View style={{ width: 38 }} /></View>
      <ScrollView contentContainerStyle={styles.content}>
        {submitted ? (
          <View style={styles.successCard}><Ionicons name="checkmark-circle" size={48} color={colors.secondary.emerald}/><Text style={styles.successTitle}>Ticket Submitted</Text><Text style={styles.successId}>Your ticket ID: {submitted}</Text><Text style={styles.successSub}>We will respond within 24 hours.</Text></View>
        ) : (
          <>
            <View style={styles.fieldGroup}><Text style={styles.label}>Subject</Text><TextInput style={styles.input} value={subject} onChangeText={setSubject} placeholder="Brief description..." placeholderTextColor={colors.neutral.placeholder}/></View>
            <View style={styles.fieldGroup}><Text style={styles.label}>Category</Text><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{gap:8}}>{CATEGORIES.map(c=>(<Pressable key={c} style={[styles.catChip,cat===c&&styles.catChipActive]} onPress={()=>setCat(c)}><Text style={[styles.catChipText,cat===c&&styles.catChipTextActive]}>{c}</Text></Pressable>))}</ScrollView></View>
            <View style={styles.fieldGroup}><Text style={styles.label}>Message</Text><TextInput style={[styles.input,styles.textarea]} value={message} onChangeText={setMessage} placeholder="Describe your issue in detail..." placeholderTextColor={colors.neutral.placeholder} multiline numberOfLines={5} textAlignVertical="top"/></View>
            <Pressable style={styles.attachBtn}><Ionicons name="attach" size={18} color={colors.secondary.DEFAULT}/><Text style={styles.attachBtnText}>Add Attachment</Text></Pressable>
            <Pressable style={styles.primaryBtn} onPress={submit}><Text style={styles.primaryBtnText}>Submit Ticket</Text></Pressable>
          </>
        )}
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
  fieldGroup:{gap:8},
  label:{fontSize:13,fontWeight:'600',color:colors.neutral.textMuted},
  input:{backgroundColor:colors.neutral.surface,borderRadius:12,padding:14,fontSize:15,color:colors.neutral.text,borderWidth:1,borderColor:colors.neutral.border},
  textarea:{height:120,paddingTop:14},
  catChip:{paddingHorizontal:14,paddingVertical:7,borderRadius:20,backgroundColor:colors.neutral.surface,borderWidth:1.5,borderColor:colors.neutral.border},
  catChipActive:{backgroundColor:colors.primary.DEFAULT,borderColor:colors.primary.DEFAULT},
  catChipText:{fontSize:13,fontWeight:'600',color:colors.neutral.textMuted},
  catChipTextActive:{color:'#fff'},
  attachBtn:{flexDirection:'row',alignItems:'center',gap:8,paddingVertical:10},
  attachBtnText:{fontSize:14,fontWeight:'600',color:colors.secondary.DEFAULT},
  primaryBtn:{backgroundColor:colors.primary.DEFAULT,borderRadius:14,height:52,alignItems:'center',justifyContent:'center'},
  primaryBtnText:{color:'#fff',fontSize:16,fontWeight:'700'},
  successCard:{backgroundColor:colors.neutral.surface,borderRadius:16,padding:32,alignItems:'center',gap:10,marginTop:20},
  successTitle:{fontSize:20,fontWeight:'800',color:colors.neutral.text},
  successId:{fontSize:15,fontWeight:'700',color:colors.primary.DEFAULT},
  successSub:{fontSize:13,color:colors.neutral.textMuted,textAlign:'center'},
});
