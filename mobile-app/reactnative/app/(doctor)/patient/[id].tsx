import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Modal, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import {
  Droplet, Dna, AlertTriangle, Pill, MessageCircle, NotebookPen, ShieldCheck, Share2,
  CalendarClock, ChevronRight, ShieldAlert, Ban, FileText, Image as ImageIcon, Users, ClipboardList,
  FlaskConical, Stethoscope, X, HeartPulse, Siren,
} from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import PrimaryButton from '@/components/PrimaryButton';
import { TeleHeader, DoctorAvatar } from '@/features/telemedicine/components';
import { SectionCard, InfoRow, StateView, AlertCard, StatusBadge, BarRow, StatusTimeline } from '@/features/doctor/components';
import type { TimelineStep } from '@/features/doctor/components';
import { usePatientFullProfile, useAppointment } from '@/features/doctor/hooks';
import { PATIENT_TYPE_LABELS, PATIENT_DOCUMENT_KIND_LABELS } from '@/features/doctor/constants';
import type { ClinicalAlertSeverity, PatientImage } from '@/types/doctor.batch2';

type AlertTone = 'info' | 'warning' | 'critical';
const toTone = (s: ClinicalAlertSeverity): AlertTone => (s === 'critical' ? 'critical' : s === 'warning' ? 'warning' : 'info');
const fmtDate = (iso: string) => new Date(iso.length <= 10 ? `${iso}T00:00:00` : iso).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' });

export default function PatientProfileScreen() {
  const { id, apptId } = useLocalSearchParams<{ id: string; apptId?: string }>();
  const { data: profile, isLoading, isError, refetch } = usePatientFullProfile(String(id));
  const appointmentId = apptId ? String(apptId) : '';
  const { data: appointment } = useAppointment(appointmentId);

  const [docsOpen, setDocsOpen]       = useState(false);   // G13
  const [imagesOpen, setImagesOpen]   = useState(false);   // G14
  const [depsOpen, setDepsOpen]       = useState(false);   // G20
  const [viewerImage, setViewerImage] = useState<PatientImage | null>(null); // image viewer

  const alerts = profile?.alerts;
  const allAlerts = useMemo(() => {
    if (!alerts) return [];
    return [
      ...alerts.riskWarnings.map((a) => ({ id: a.id, icon: ShieldAlert as LucideIcon, tone: toTone(a.severity), title: a.title, body: a.detail })),
      ...alerts.drugAllergyAlerts.map((a) => ({ id: a.id, icon: Ban as LucideIcon, tone: toTone(a.severity), title: `Drug allergy: ${a.allergen}`, body: `${a.drug} — ${a.reaction}. ${a.detail}` })),
      ...alerts.contraindications.map((a) => ({ id: a.id, icon: AlertTriangle as LucideIcon, tone: toTone(a.severity), title: `Contraindication: ${a.subject}`, body: `Conflicts with ${a.conflictsWith}. ${a.detail}` })),
    ];
  }, [alerts]);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader title="Patient Profile" />

      {isLoading && !profile ? (
        <StateView variant="loading" label="Loading patient record" />
      ) : isError || !profile ? (
        <StateView variant="error" message="We could not load this patient's record." onRetry={() => refetch()} />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
          {/* Patient header + patient-type badge (G1/G21/G22) */}
          <View style={styles.patientHeader}>
            <DoctorAvatar initials={profile.base.patient.initials} color={profile.base.patient.avatarColor} size={64} />
            <View style={styles.patientInfo}>
              <Text style={styles.patientName} numberOfLines={1}>{profile.base.patient.name}</Text>
              <Text style={styles.patientMeta}>{profile.base.patient.age} yrs · {profile.base.patient.gender}</Text>
              <View style={styles.badgeRow}>
                <StatusBadge label={PATIENT_TYPE_LABELS[profile.demographics.patientType]} tone="brand" />
                {profile.demographics.hasCaregiver && <StatusBadge label="Caregiver present" tone="info" />}
              </View>
            </View>
          </View>

          {/* Clinical alert banners (G23/G24/G25) */}
          {allAlerts.length > 0 && (
            <View style={styles.alertStack}>
              {allAlerts.map((a) => (
                <AlertCard key={a.id} icon={a.icon} tone={a.tone} title={a.title} body={a.body} />
              ))}
            </View>
          )}

          {/* Quick markers */}
          <View style={styles.markerRow}>
            <Marker icon={Droplet} label="Blood group" value={profile.base.bloodGroup} color={Colors.error} bg={Colors.iconBgRed} />
            <Marker icon={Dna} label="Genotype" value={profile.base.genotype} color={Colors.primary} bg={Colors.iconBgPurple} />
          </View>

          {/* Chief complaint (G4) */}
          <SectionCard title="Chief complaint" style={styles.card}>
            <Text style={styles.body}>{profile.chiefComplaint || 'Not recorded.'}</Text>
          </SectionCard>

          {/* Demographics (G3) */}
          <SectionCard title="Demographics" style={styles.card}>
            {profile.demographics.dateOfBirth && <InfoRow label="Date of birth" value={fmtDate(profile.demographics.dateOfBirth)} />}
            <InfoRow label="Patient type" value={PATIENT_TYPE_LABELS[profile.demographics.patientType]} />
            {profile.demographics.maritalStatus && <InfoRow label="Marital status" value={profile.demographics.maritalStatus} />}
            {profile.demographics.occupation && <InfoRow label="Occupation" value={profile.demographics.occupation} />}
            {(profile.demographics.city || profile.demographics.state) && (
              <InfoRow label="Residence" value={[profile.demographics.city, profile.demographics.state].filter(Boolean).join(', ')} />
            )}
            {profile.demographics.language && <InfoRow label="Preferred language" value={profile.demographics.language} />}
          </SectionCard>

          {/* Submitted symptoms (G5) */}
          <SectionCard title="Submitted symptoms" style={styles.card}>
            {profile.submittedSymptoms.length === 0 ? (
              <Text style={styles.muted}>No symptoms submitted.</Text>
            ) : (
              profile.submittedSymptoms.map((s, i) => (
                <View key={s.id} style={[styles.symptomRow, i > 0 && styles.rowBorder]}>
                  <View style={styles.symptomHead}>
                    <Text style={styles.symptomLabel}>{s.label}</Text>
                    <StatusBadge label={s.severity} tone={s.severity === 'severe' ? 'danger' : s.severity === 'moderate' ? 'warning' : 'success'} />
                  </View>
                  <Text style={styles.symptomMeta}>{s.duration}{s.note ? ` · ${s.note}` : ''}</Text>
                </View>
              ))
            )}
          </SectionCard>

          {/* Allergy history (G7) — richer than base.allergies */}
          <SectionCard title="Allergy history" style={styles.card}>
            {profile.allergyHistory.length === 0 ? (
              <Text style={styles.muted}>No known allergies.</Text>
            ) : (
              profile.allergyHistory.map((a, i) => (
                <View key={a.id} style={[styles.listRow, i > 0 && styles.rowBorder]}>
                  <AlertTriangle size={16} color={Colors.error} strokeWidth={2} />
                  <View style={styles.listBody}>
                    <Text style={styles.listTitle}>{a.allergen} <Text style={styles.listMeta}>({a.type})</Text></Text>
                    <Text style={styles.listMeta}>{a.reaction} · {a.severity}</Text>
                  </View>
                </View>
              ))
            )}
          </SectionCard>

          {/* Current medications (G8) */}
          <SectionCard title="Current medications" style={styles.card}>
            {profile.base.currentMedications.length === 0 ? (
              <Text style={styles.muted}>No current medications.</Text>
            ) : (
              profile.base.currentMedications.map((m, i) => (
                <View key={m} style={[styles.listRow, i > 0 && styles.rowBorder]}>
                  <Pill size={16} color={Colors.primary} strokeWidth={2} />
                  <Text style={styles.body}>{m}</Text>
                </View>
              ))
            )}
          </SectionCard>

          {/* Chronic conditions (G9) */}
          <SectionCard title="Chronic conditions" style={styles.card}>
            {profile.base.chronicConditions.length === 0 ? (
              <Text style={styles.muted}>None recorded.</Text>
            ) : (
              <View style={styles.tagWrap}>
                {profile.base.chronicConditions.map((c) => (
                  <View key={c} style={styles.conditionTag}><Text style={styles.conditionText}>{c}</Text></View>
                ))}
              </View>
            )}
          </SectionCard>

          {/* Past surgeries (G10) */}
          <SectionCard title="Past surgeries" style={styles.card}>
            {profile.pastSurgeries.length === 0 ? (
              <Text style={styles.muted}>No past surgeries.</Text>
            ) : (
              profile.pastSurgeries.map((s, i) => (
                <View key={s.id} style={[styles.listRow, i > 0 && styles.rowBorder]}>
                  <Stethoscope size={16} color={Colors.secondary} strokeWidth={2} />
                  <View style={styles.listBody}>
                    <Text style={styles.listTitle}>{s.procedure} · {s.year}</Text>
                    {(s.hospital || s.note) && <Text style={styles.listMeta}>{[s.hospital, s.note].filter(Boolean).join(' · ')}</Text>}
                  </View>
                </View>
              ))
            )}
          </SectionCard>

          {/* Family medical history (G11) */}
          <SectionCard title="Family medical history" style={styles.card}>
            {profile.familyHistory.length === 0 ? (
              <Text style={styles.muted}>No family history recorded.</Text>
            ) : (
              profile.familyHistory.map((f, i) => (
                <View key={f.id} style={[styles.listRow, i > 0 && styles.rowBorder]}>
                  <Users size={16} color={Colors.teal} strokeWidth={2} />
                  <View style={styles.listBody}>
                    <Text style={styles.listTitle}>{f.condition}</Text>
                    <Text style={styles.listMeta}>{f.relation}{f.note ? ` · ${f.note}` : ''}</Text>
                  </View>
                </View>
              ))
            )}
          </SectionCard>

          {/* Vitals history (G12) — trend via reused BarRow */}
          <SectionCard title="Vitals history" style={styles.card}>
            {profile.vitalsHistory.length === 0 ? (
              <Text style={styles.muted}>No vitals history.</Text>
            ) : (
              profile.vitalsHistory.map((reading) => (
                <View key={reading.recordedAt} style={styles.vitalGroup}>
                  <Text style={styles.vitalDate}>{fmtDate(reading.recordedAt)}</Text>
                  {reading.vitals.map((v) => <InfoRow key={v.label} label={v.label} value={v.value} />)}
                </View>
              ))
            )}
            {(() => {
              const series = profile.vitalsHistory
                .map((r) => {
                  const bp = r.vitals.find((v) => /pressure|bp|sys/i.test(v.label));
                  const n = bp ? parseInt(bp.value, 10) : NaN;
                  return { label: fmtDate(r.recordedAt).split(' ').slice(0, 2).join(' '), value: Number.isNaN(n) ? 0 : n };
                })
                .filter((p) => p.value > 0);
              return series.length > 1 ? <View style={styles.trend}><BarRow title="Systolic BP trend" points={series} tint={Colors.secondary} /></View> : null;
            })()}
          </SectionCard>

          {/* Previous consultations (G15) — reused StatusTimeline */}
          <SectionCard title="Previous consultations" style={styles.card}>
            {profile.previousConsults.length === 0 ? (
              <Text style={styles.muted}>No previous consultations.</Text>
            ) : (
              <StatusTimeline
                steps={profile.previousConsults.map<TimelineStep>((c) => ({
                  label: c.summary,
                  at: `${fmtDate(c.date)} · ${c.doctorName} · ${c.consultType}`,
                  note: c.diagnosis.length ? c.diagnosis.join(', ') : undefined,
                  completed: true,
                }))}
              />
            )}
          </SectionCard>

          {/* Previous prescriptions (G16) */}
          <SectionCard title="Previous prescriptions" style={styles.card}>
            {profile.previousPrescriptions.length === 0 ? (
              <Text style={styles.muted}>No previous prescriptions.</Text>
            ) : (
              profile.previousPrescriptions.map((p, i) => (
                <Pressable key={p.id} style={[styles.listRow, i > 0 && styles.rowBorder]} onPress={() => router.push(`/(doctor)/prescriptions/index`)} accessibilityRole="button" accessibilityLabel={`Prescription ${p.ref}`}>
                  <ClipboardList size={16} color={Colors.primary} strokeWidth={2} />
                  <View style={styles.listBody}>
                    <Text style={styles.listTitle}>{p.ref} · {p.diagnosis}</Text>
                    <Text style={styles.listMeta}>{p.items.length} item{p.items.length === 1 ? '' : 's'} · {fmtDate(p.issuedAt)} · {p.status}</Text>
                  </View>
                  <ChevronRight size={16} color={Colors.onSurfaceVariant} strokeWidth={2} />
                </Pressable>
              ))
            )}
          </SectionCard>

          {/* Previous lab results (G17) */}
          <SectionCard title="Previous lab results" style={styles.card}>
            {profile.previousLabResults.length === 0 ? (
              <Text style={styles.muted}>No previous lab results.</Text>
            ) : (
              profile.previousLabResults.map((l, i) => (
                <View key={l.id} style={[styles.listRow, i > 0 && styles.rowBorder]}>
                  <FlaskConical size={16} color={Colors.teal} strokeWidth={2} />
                  <View style={styles.listBody}>
                    <Text style={styles.listTitle}>{l.ref} · {l.labName}</Text>
                    <Text style={styles.listMeta}>{l.values.length} value{l.values.length === 1 ? '' : 's'} · {fmtDate(l.reportedAt)}{l.reviewed ? ' · reviewed' : ''}</Text>
                  </View>
                </View>
              ))
            )}
          </SectionCard>

          {/* HMO coverage summary (G18) */}
          {profile.hmoCoverage && (
            <SectionCard title="HMO coverage" style={styles.card}>
              <InfoRow label="Provider" value={profile.hmoCoverage.provider} />
              <InfoRow label="Plan" value={profile.hmoCoverage.planName} />
              <InfoRow label="Member ID" value={profile.hmoCoverage.memberId} />
              <InfoRow label="Valid until" value={fmtDate(profile.hmoCoverage.validUntil)} />
              {profile.hmoCoverage.coveredServices.length > 0 && (
                <View style={styles.tagWrap}>
                  {profile.hmoCoverage.coveredServices.map((s) => (
                    <View key={s} style={styles.conditionTag}><Text style={styles.conditionText}>{s}</Text></View>
                  ))}
                </View>
              )}
            </SectionCard>
          )}

          {/* Emergency contact (G19) */}
          {profile.emergencyContact && (
            <SectionCard title="Emergency contact" style={styles.card}>
              <InfoRow label="Name" value={profile.emergencyContact.name} />
              <InfoRow label="Relation" value={profile.emergencyContact.relation} />
              <InfoRow label="Phone" value={profile.emergencyContact.phone} />
              {profile.emergencyContact.email && <InfoRow label="Email" value={profile.emergencyContact.email} />}
            </SectionCard>
          )}

          {/* Documents / images / dependents — sheets (G13/G14/G20) */}
          <SectionCard title="Records & attachments" style={styles.card}>
            <CareLink icon={FileText} label={`Uploaded documents (${profile.documents.length})`} color={Colors.primary} bg={Colors.iconBgPurple} onPress={() => setDocsOpen(true)} />
            <CareLink icon={ImageIcon} label={`Uploaded images (${profile.images.length})`} color={Colors.secondary} bg={Colors.iconBgBlue} onPress={() => setImagesOpen(true)} border />
            {profile.dependents.length > 0 && (
              <CareLink icon={Users} label={`Dependents (${profile.dependents.length})`} color={Colors.teal} bg={Colors.iconBgTeal} onPress={() => setDepsOpen(true)} border />
            )}
          </SectionCard>

          {/* Care management */}
          <SectionCard title="Care management" style={styles.card}>
            <CareLink icon={NotebookPen} label="Full medical records" color={Colors.primary} bg={Colors.iconBgPurple} onPress={() => router.push(`/(doctor)/records/${profile.base.patient.id}`)} />
            <CareLink icon={Share2} label="Refer to specialist" color={Colors.teal} bg={Colors.iconBgTeal} onPress={() => router.push(`/(doctor)/referrals/new?patientId=${profile.base.patient.id}&patientName=${encodeURIComponent(profile.base.patient.name)}`)} border />
            <CareLink icon={CalendarClock} label="Create follow-up" color={Colors.secondary} bg={Colors.iconBgBlue} onPress={() => router.push(`/(doctor)/follow-ups/new?patientId=${profile.base.patient.id}&patientName=${encodeURIComponent(profile.base.patient.name)}${appointmentId ? `&appointmentId=${appointmentId}` : ''}`)} border />
            <CareLink icon={HeartPulse} label="Care plans" color={Colors.teal} bg={Colors.iconBgTeal} onPress={() => router.push('/(doctor)/care-plans')} border />
            <CareLink icon={Siren} label="Emergency hub (demo)" color={Colors.error} bg={Colors.iconBgRed} onPress={() => router.push(`/(doctor)/emergency?patientId=${profile.base.patient.id}`)} border />
          </SectionCard>

          {appointmentId ? (
            <SectionCard title="Consultation" style={styles.card}>
              <PrimaryButton label="Start consultation" onPress={() => router.push(`/(doctor)/consult/${appointmentId}/call`)} style={styles.btn} />
              <View style={styles.actionRow}>
                <Pressable style={styles.actionBtn} onPress={() => router.push(`/(doctor)/consult/${appointmentId}/chat`)} accessibilityRole="button" accessibilityLabel="Open chat consultation">
                  <MessageCircle size={18} color={Colors.secondary} strokeWidth={2} />
                  <Text style={styles.actionText}>Chat</Text>
                </Pressable>
                <Pressable style={styles.actionBtn} onPress={() => router.push(`/(doctor)/consult/${appointmentId}/notes`)} accessibilityRole="button" accessibilityLabel="Open consultation notes">
                  <NotebookPen size={18} color={Colors.primary} strokeWidth={2} />
                  <Text style={styles.actionText}>Notes</Text>
                </Pressable>
              </View>
              {appointment?.isHmo && (
                <Pressable style={[styles.actionBtn, styles.hmoBtn]} onPress={() => router.push(`/(doctor)/consult/${appointmentId}/hmo`)} accessibilityRole="button" accessibilityLabel="View HMO coverage">
                  <ShieldCheck size={18} color={Colors.teal} strokeWidth={2} />
                  <Text style={styles.actionText}>HMO coverage</Text>
                </Pressable>
              )}
            </SectionCard>
          ) : (
            <PrimaryButton label="Open consultation notes" onPress={() => router.push(`/(doctor)/consult/${profile.base.patient.id}/notes`)} variant="secondary" style={styles.btn} />
          )}
        </ScrollView>
      )}

      {/* Documents sheet (G13) */}
      <BottomSheet visible={docsOpen} title="Uploaded documents" onClose={() => setDocsOpen(false)}>
        {profile?.documents.length ? profile.documents.map((d, i) => (
          <View key={d.id} style={[styles.listRow, i > 0 && styles.rowBorder]}>
            <View style={[styles.docIcon, { backgroundColor: Colors.iconBgPurple }]}><FileText size={16} color={Colors.primary} strokeWidth={2} /></View>
            <View style={styles.listBody}>
              <Text style={styles.listTitle} numberOfLines={1}>{d.title}</Text>
              <Text style={styles.listMeta}>{PATIENT_DOCUMENT_KIND_LABELS[d.kind]} · {fmtDate(d.uploadedAt)}{d.source ? ` · ${d.source}` : ''}</Text>
            </View>
          </View>
        )) : <Text style={styles.muted}>No documents uploaded.</Text>}
      </BottomSheet>

      {/* Images sheet (G14) — tap to open viewer */}
      <BottomSheet visible={imagesOpen} title="Uploaded images" onClose={() => setImagesOpen(false)}>
        {profile?.images.length ? (
          <View style={styles.imageGrid}>
            {profile.images.map((img) => (
              <Pressable key={img.id} onPress={() => setViewerImage(img)} accessibilityRole="button" accessibilityLabel={img.caption ?? 'View image'}>
                <Image source={{ uri: img.uri }} style={styles.thumb} resizeMode="cover" />
              </Pressable>
            ))}
          </View>
        ) : <Text style={styles.muted}>No images uploaded.</Text>}
      </BottomSheet>

      {/* Dependents sheet (G20) */}
      <BottomSheet visible={depsOpen} title="Dependents" onClose={() => setDepsOpen(false)}>
        {profile?.dependents.length ? profile.dependents.map((d, i) => (
          <Pressable key={d.id} style={[styles.depRow, i > 0 && styles.rowBorder]} onPress={() => { setDepsOpen(false); router.push(`/(doctor)/patient/${d.id}`); }} accessibilityRole="button" accessibilityLabel={`Open ${d.name}`}>
            <DoctorAvatar initials={d.initials} color={d.avatarColor} size={40} />
            <View style={styles.listBody}>
              <Text style={styles.listTitle}>{d.name}</Text>
              <Text style={styles.listMeta}>{d.relation} · {PATIENT_TYPE_LABELS[d.patientType]}{typeof d.ageMonths === 'number' ? ` · ${d.ageMonths} mo` : ''}</Text>
            </View>
            <ChevronRight size={16} color={Colors.onSurfaceVariant} strokeWidth={2} />
          </Pressable>
        )) : <Text style={styles.muted}>No dependents.</Text>}
      </BottomSheet>

      {/* Image viewer */}
      <Modal visible={!!viewerImage} transparent animationType="fade" onRequestClose={() => setViewerImage(null)}>
        <View style={styles.viewerBackdrop}>
          <Pressable style={styles.viewerClose} onPress={() => setViewerImage(null)} hitSlop={16} accessibilityRole="button" accessibilityLabel="Close image">
            <X size={24} color={Colors.white} strokeWidth={2} />
          </Pressable>
          {viewerImage && <Image source={{ uri: viewerImage.uri }} style={styles.viewerImage} resizeMode="contain" />}
          {!!viewerImage?.caption && <Text style={styles.viewerCaption}>{viewerImage.caption}</Text>}
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function BottomSheet({ visible, title, onClose, children }: { visible: boolean; title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.sheet}>
        <View style={styles.sheetHandle} />
        <View style={styles.sheetHeader}>
          <Text style={styles.sheetTitle}>{title}</Text>
          <Pressable onPress={onClose} hitSlop={16} accessibilityRole="button" accessibilityLabel="Close"><X size={20} color={Colors.onSurfaceVariant} strokeWidth={2} /></Pressable>
        </View>
        <ScrollView style={styles.sheetScroll} showsVerticalScrollIndicator={false}>{children}</ScrollView>
      </View>
    </Modal>
  );
}

function Marker({ icon: Icon, label, value, color, bg }: { icon: LucideIcon; label: string; value: string; color: string; bg: string }) {
  return (
    <View style={styles.marker}>
      <View style={[styles.markerIcon, { backgroundColor: bg }]}><Icon size={18} color={color} strokeWidth={2} /></View>
      <Text style={styles.markerValue}>{value}</Text>
      <Text style={styles.markerLabel}>{label}</Text>
    </View>
  );
}

function CareLink({ icon: Icon, label, color, bg, onPress, border }: { icon: LucideIcon; label: string; color: string; bg: string; onPress: () => void; border?: boolean }) {
  return (
    <Pressable style={[styles.careRow, border && styles.rowBorder]} onPress={onPress} accessibilityRole="button" accessibilityLabel={label}>
      <View style={[styles.careIcon, { backgroundColor: bg }]}><Icon size={18} color={color} strokeWidth={2} /></View>
      <Text style={styles.careLabel}>{label}</Text>
      <ChevronRight size={18} color={Colors.onSurfaceVariant} strokeWidth={2} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe:           { flex: 1, backgroundColor: Colors.background },
  careRow:        { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.sm },
  careIcon:       { width: 36, height: 36, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  careLabel:      { ...Typography.labelMd, color: Colors.onSurface, flex: 1 },
  content:        { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Spacing.xxl },
  patientHeader:  { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, marginBottom: Spacing.lg },
  patientInfo:    { flex: 1, gap: 2 },
  patientName:    { ...Typography.headlineMd, color: Colors.onSurface },
  patientMeta:    { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textTransform: 'capitalize' },
  badgeRow:       { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs, marginTop: Spacing.xs },
  alertStack:     { gap: Spacing.sm, marginBottom: Spacing.md },
  markerRow:      { flexDirection: 'row', gap: Spacing.md, marginBottom: Spacing.md },
  marker:         { flex: 1, alignItems: 'flex-start', gap: Spacing.xs, padding: Spacing.md, borderRadius: Radius.lg, backgroundColor: Colors.surfaceContainerLowest, borderWidth: 1, borderColor: Colors.surfaceContainerHigh },
  markerIcon:     { width: 36, height: 36, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  markerValue:    { ...Typography.titleMd, color: Colors.onSurface, fontWeight: '700' },
  markerLabel:    { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  card:           { marginBottom: Spacing.md },
  body:           { ...Typography.bodyMd, color: Colors.onSurface, flex: 1 },
  muted:          { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  tagWrap:        { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, marginTop: Spacing.xs },
  conditionTag:   { height: 30, paddingHorizontal: 12, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.iconBgPurple },
  conditionText:  { ...Typography.labelSm, color: Colors.primary, fontWeight: '600' },
  rowBorder:      { borderTopWidth: 1, borderTopColor: Colors.surfaceContainerHigh },
  symptomRow:     { paddingVertical: Spacing.sm, gap: 2 },
  symptomHead:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  symptomLabel:   { ...Typography.labelMd, color: Colors.onSurface },
  symptomMeta:    { ...Typography.caption, color: Colors.onSurfaceVariant },
  listRow:        { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.sm },
  listBody:       { flex: 1, gap: 2 },
  listTitle:      { ...Typography.labelMd, color: Colors.onSurface },
  listMeta:       { ...Typography.caption, color: Colors.onSurfaceVariant },
  vitalGroup:     { gap: 2, paddingVertical: Spacing.sm, borderTopWidth: 1, borderTopColor: Colors.surfaceContainerHigh },
  vitalDate:      { ...Typography.labelSm, color: Colors.primary, fontWeight: '700' },
  trend:          { marginTop: Spacing.md },
  docIcon:        { width: 32, height: 32, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  imageGrid:      { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  thumb:          { width: 96, height: 96, borderRadius: Radius.md, backgroundColor: Colors.surfaceContainerHigh },
  depRow:         { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.sm },
  btn:            { marginTop: Spacing.sm },
  actionRow:      { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.sm },
  actionBtn:      { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, height: 48, borderRadius: Radius.lg, backgroundColor: Colors.surfaceContainerLow, borderWidth: 1, borderColor: Colors.surfaceContainerHigh },
  hmoBtn:         { marginTop: Spacing.sm },
  actionText:     { ...Typography.labelMd, color: Colors.onSurface },
  backdrop:       { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet:          { backgroundColor: Colors.surfaceContainerLowest, borderTopLeftRadius: Radius.xl, borderTopRightRadius: Radius.xl, padding: Spacing.lg, paddingBottom: 40, maxHeight: '80%' },
  sheetScroll:    { marginTop: Spacing.xs },
  sheetHandle:    { width: 40, height: 4, borderRadius: 2, backgroundColor: Colors.surfaceContainerHigh, alignSelf: 'center', marginBottom: Spacing.md },
  sheetHeader:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing.md },
  sheetTitle:     { ...Typography.titleMd, color: Colors.onSurface },
  viewerBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', alignItems: 'center', justifyContent: 'center', padding: Spacing.lg },
  viewerClose:    { position: 'absolute', top: 48, right: Spacing.containerMargin, zIndex: 2 },
  viewerImage:    { width: '100%', height: '70%' },
  viewerCaption:  { ...Typography.bodyMd, color: Colors.white, textAlign: 'center', marginTop: Spacing.md },
});
