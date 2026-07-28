// Shared reference DATA for the registration engine.
//
// This module is intentionally a *leaf*: it imports nothing from the form
// modules or from config.ts, so the per-contest form files can freely import
// these constants without creating an import cycle.
//
// IMPORTANT: this file holds *data* that is legitimately shared across every
// contest (the list of Nigerian states, cities, the contest catalog, etc.).
// The *form structure* for each contest — which fields/steps appear and whether
// they are required — lives in its own file under `./forms/`, so editing one
// contest's form never affects another. Only edit this file when you want a
// change to apply to the shared reference data for ALL contests.

import type { ContestRegistrationDefinition } from './types';

export const NIGERIA_STATES = [
  'Abia', 'Adamawa', 'Akwa Ibom', 'Anambra', 'Bauchi', 'Bayelsa', 'Benue', 'Borno',
  'Cross River', 'Delta', 'Ebonyi', 'Edo', 'Ekiti', 'Enugu', 'FCT Abuja', 'Gombe',
  'Imo', 'Jigawa', 'Kaduna', 'Kano', 'Katsina', 'Kebbi', 'Kogi', 'Kwara', 'Lagos',
  'Nasarawa', 'Niger', 'Ogun', 'Ondo', 'Osun', 'Oyo', 'Plateau', 'Rivers', 'Sokoto',
  'Taraba', 'Yobe', 'Zamfara',
];

export const NIGERIA_CITIES_BY_STATE: Record<string, string[]> = {
  Abia: ["Aba North", "Aba South", "Arochukwu", "Bende", "Ikwuano", "Isiala Ngwa North", "Isiala Ngwa South", "Isuikwuato", "Obi Ngwa", "Ohafia", "Osisioma", "Ugwunagbo", "Ukwa East", "Ukwa West", "Umuahia North", "Umuahia South", "Umu Nneochi"],
  Adamawa: ["Demsa", "Fufure", "Ganye", "Gayuk", "Gombi", "Grie", "Hong", "Jada", "Lamurde", "Madagali", "Maiha", "Mayo-Belwa", "Michika", "Mubi North", "Mubi South", "Numan", "Shelleng", "Song", "Toungo", "Yola North", "Yola South"],
  "Akwa Ibom": ["Abak", "Eastern Obolo", "Eket", "Esit Eket", "Essien Udim", "Etim Ekpo", "Etinan", "Ibeno", "Ibesikpo Asutan", "Ibiono-Ibom", "Ika", "Ikono", "Ikot Abasi", "Ikot Ekpene", "Ini", "Itu", "Mbo", "Mkpat-Enin", "Nsit-Atai", "Nsit-Ibom", "Nsit-Ubium", "Obot Akara", "Okobo", "Onna", "Oron", "Oruk Anam", "Udung-Uko", "Ukanafun", "Uruan", "Urue-Offong/Oruko", "Uyo"],
  Anambra: ["Aguata", "Anambra East", "Anambra West", "Anaocha", "Awka North", "Awka South", "Ayamelum", "Dunukofia", "Ekwusigo", "Idemili North", "Idemili South", "Ihiala", "Njikoka", "Nnewi North", "Nnewi South", "Ogbaru", "Onitsha North", "Onitsha South", "Orumba North", "Orumba South", "Oyi"],
  Bauchi: ["Alkaleri", "Bauchi", "Bogoro", "Damban", "Darazo", "Dass", "Gamawa", "Ganjuwa", "Giade", "Itas/Gadau", "Jama'are", "Katagum", "Kirfi", "Misau", "Ningi", "Shira", "Tafawa Balewa", "Toro", "Warji", "Zaki"],
  Bayelsa: ["Brass", "Ekeremor", "Kolokuma/Opokuma", "Nembe", "Ogbia", "Sagbama", "Southern Ijaw", "Yenagoa"],
  Benue: ["Ado", "Agatu", "Apa", "Buruku", "Gboko", "Guma", "Gwer East", "Gwer West", "Katsina-Ala", "Konshisha", "Kwande", "Logo", "Makurdi", "Obi", "Ogbadibo", "Ohimini", "Oju", "Okpokwu", "Oturkpo", "Tarka", "Ukum", "Ushongo", "Vandeikya"],
  Borno: ["Abadam", "Askira/Uba", "Bama", "Bayo", "Biu", "Chibok", "Damboa", "Dikwa", "Gubio", "Guzamala", "Gwoza", "Hawul", "Jere", "Kaga", "Kala/Balge", "Konduga", "Kukawa", "Kwaya Kusar", "Mafa", "Magumeri", "Maiduguri", "Marte", "Mobbar", "Monguno", "Ngala", "Nganzai", "Shani"],
  "Cross River": ["Abi", "Akamkpa", "Akpabuyo", "Bakassi", "Bekwarra", "Biase", "Boki", "Calabar Municipal", "Calabar South", "Etung", "Ikom", "Obanliku", "Obubra", "Obudu", "Odukpani", "Ogoja", "Yakuur", "Yala"],
  Delta: ["Aniocha North", "Aniocha South", "Bomadi", "Burutu", "Ethiope East", "Ethiope West", "Ika North East", "Ika South", "Isoko North", "Isoko South", "Ndokwa East", "Ndokwa West", "Okpe", "Oshimili North", "Oshimili South", "Patani", "Sapele", "Udu", "Ughelli North", "Ughelli South", "Ukwuani", "Uvwie", "Warri North", "Warri South", "Warri South West"],
  Ebonyi: ["Abakaliki", "Afikpo North", "Afikpo South", "Ebonyi", "Ezza North", "Ezza South", "Ikwo", "Ishielu", "Ivo", "Izzi", "Ohaozara", "Ohaukwu", "Onicha"],
  Edo: ["Akoko-Edo", "Egor", "Esan Central", "Esan North-East", "Esan South-East", "Esan West", "Etsako Central", "Etsako East", "Etsako West", "Igueben", "Ikpoba-Okha", "Oredo", "Orhionmwon", "Ovia North-East", "Ovia South-West", "Owan East", "Owan West", "Uhunmwonde"],
  Ekiti: ["Ado Ekiti", "Efon", "Ekiti East", "Ekiti South-West", "Ekiti West", "Emure", "Gbonyin", "Ido/Osi", "Ijero", "Ikere", "Ikole", "Ilejemeje", "Irepodun/Ifelodun", "Ise/Orun", "Moba", "Oye"],
  Enugu: ["Aninri", "Awgu", "Enugu East", "Enugu North", "Enugu South", "Ezeagu", "Igbo Etiti", "Igbo Eze North", "Igbo Eze South", "Isi Uzo", "Nkanu East", "Nkanu West", "Nsukka", "Oji River", "Udenu", "Udi", "Uzo Uwani"],
  "FCT Abuja": ["Abaji", "Abuja Municipal", "Bwari", "Gwagwalada", "Kuje", "Kwali"],
  Gombe: ["Akko", "Balanga", "Billiri", "Dukku", "Funakaye", "Gombe", "Kaltungo", "Kwami", "Nafada", "Shomgom", "Yamaltu/Deba"],
  Imo: ["Aboh Mbaise", "Ahiazu Mbaise", "Ehime Mbano", "Ezinihitte", "Ideato North", "Ideato South", "Ihitte/Uboma", "Ikeduru", "Isiala Mbano", "Isu", "Mbaitoli", "Ngor Okpala", "Njaba", "Nkwerre", "Nwangele", "Obowo", "Oguta", "Ohaji/Egbema", "Okigwe", "Orlu", "Orsu", "Oru East", "Oru West", "Owerri Municipal", "Owerri North", "Owerri West", "Unuimo"],
  Jigawa: ["Auyo", "Babura", "Biriniwa", "Birnin Kudu", "Buji", "Dutse", "Gagarawa", "Garki", "Gumel", "Guri", "Gwaram", "Gwiwa", "Hadejia", "Jahun", "Kafin Hausa", "Kaugama", "Kazaure", "Kiri Kasama", "Maigatari", "Malam Madori", "Miga", "Ringim", "Roni", "Sule Tankarkar", "Taura", "Yankwashi"],
  Kaduna: ["Birnin Gwari", "Chikun", "Giwa", "Igabi", "Ikara", "Jaba", "Jema'a", "Kachia", "Kaduna North", "Kaduna South", "Kagarko", "Kajuru", "Kaura", "Kauru", "Kubau", "Kudan", "Lere", "Makarfi", "Sabon Gari", "Sanga", "Soba", "Zangon Kataf", "Zaria"],
  Kano: ["Ajingi", "Albasu", "Bagwai", "Bebeji", "Bichi", "Bunkure", "Dala", "Dambatta", "Dawakin Kudu", "Dawakin Tofa", "Doguwa", "Fagge", "Gabasawa", "Garko", "Garun Mallam", "Gaya", "Gezawa", "Gwale", "Gwarzo", "Kabo", "Kano Municipal", "Karaye", "Kibiya", "Kiru", "Kumbotso", "Kunchi", "Kura", "Madobi", "Makoda", "Minjibir", "Nasarawa", "Rano", "Rimin Gado", "Rogo", "Shanono", "Sumaila", "Takai", "Tarauni", "Tofa", "Tsanyawa", "Tudun Wada", "Ungogo", "Warawa", "Wudil"],
  Katsina: ["Bakori", "Batagarawa", "Batsari", "Baure", "Bindawa", "Charanchi", "Dan Musa", "Dandume", "Danja", "Daura", "Dutsi", "Dutsin-Ma", "Faskari", "Funtua", "Ingawa", "Jibia", "Kafur", "Kaita", "Kankara", "Kankia", "Katsina", "Kurfi", "Kusada", "Mai'Adua", "Malumfashi", "Mani", "Mashi", "Matazu", "Musawa", "Rimi", "Sabuwa", "Safana", "Sandamu", "Zango"],
  Kebbi: ["Aleiro", "Arewa", "Argungu", "Augie", "Bagudo", "Birnin Kebbi", "Bunza", "Dandi", "Fakai", "Gwandu", "Jega", "Kalgo", "Koko/Besse", "Maiyama", "Ngaski", "Sakaba", "Shanga", "Suru", "Wasagu/Danko", "Yauri", "Zuru"],
  Kogi: ["Adavi", "Ajaokuta", "Ankpa", "Bassa", "Dekina", "Ibaji", "Idah", "Igalamela-Odolu", "Ijumu", "Kabba/Bunu", "Kogi", "Lokoja", "Mopa-Muro", "Ofu", "Ogori/Magongo", "Okehi", "Okene", "Olamaboro", "Omala", "Yagba East", "Yagba West"],
  Kwara: ["Asa", "Baruten", "Edu", "Ekiti", "Ifelodun", "Ilorin East", "Ilorin South", "Ilorin West", "Irepodun", "Isin", "Kaiama", "Moro", "Offa", "Oke Ero", "Oyun", "Pategi"],
  Lagos: ["Agege", "Ajeromi-Ifelodun", "Alimosho", "Amuwo-Odofin", "Apapa", "Badagry", "Epe", "Eti-Osa", "Ibeju-Lekki", "Ifako-Ijaiye", "Ikeja", "Ikorodu", "Kosofe", "Lagos Island", "Lagos Mainland", "Mushin", "Ojo", "Oshodi-Isolo", "Shomolu", "Surulere"],
  Nasarawa: ["Akwanga", "Awe", "Doma", "Karu", "Keana", "Keffi", "Kokona", "Lafia", "Nasarawa", "Nasarawa Egon", "Obi", "Toto", "Wamba"],
  Niger: ["Agaie", "Agwara", "Bida", "Borgu", "Bosso", "Chanchaga", "Edati", "Gbako", "Gurara", "Katcha", "Kontagora", "Lapai", "Lavun", "Magama", "Mariga", "Mashegu", "Mokwa", "Moya", "Paikoro", "Rafi", "Rijau", "Shiroro", "Suleja", "Tafa", "Wushishi"],
  Ogun: ["Abeokuta North", "Abeokuta South", "Ado-Odo/Ota", "Egbado North", "Egbado South", "Ewekoro", "Ifo", "Ijebu East", "Ijebu North", "Ijebu North East", "Ijebu Ode", "Ikenne", "Imeko Afon", "Ipokia", "Obafemi Owode", "Odeda", "Odogbolu", "Ogun Waterside", "Remo North", "Shagamu"],
  Ondo: ["Akoko North-East", "Akoko North-West", "Akoko South-East", "Akoko South-West", "Akure North", "Akure South", "Ese Odo", "Idanre", "Ifedore", "Ilaje", "Ile Oluji/Okeigbo", "Irele", "Odigbo", "Okitipupa", "Ondo East", "Ondo West", "Ose", "Owo"],
  Osun: ["Aiyedade", "Aiyedire", "Atakumosa East", "Atakumosa West", "Boluwaduro", "Boripe", "Ede North", "Ede South", "Egbedore", "Ejigbo", "Ife Central", "Ife East", "Ife North", "Ife South", "Ifedayo", "Ifelodun", "Ila", "Ilesa East", "Ilesa West", "Irepodun", "Irewole", "Isokan", "Iwo", "Obokun", "Odo-Otin", "Ola-Oluwa", "Olorunda", "Oriade", "Orolu", "Osogbo"],
  Oyo: ["Afijio", "Akinyele", "Atiba", "Atisbo", "Egbeda", "Ibadan North", "Ibadan North-East", "Ibadan North-West", "Ibadan South-East", "Ibadan South-West", "Ibarapa Central", "Ibarapa East", "Ibarapa North", "Ido", "Irepo", "Iseyin", "Itesiwaju", "Iwajowa", "Kajola", "Lagelu", "Ogbomosho North", "Ogbomosho South", "Ogo Oluwa", "Olorunsogo", "Oluyole", "Ona Ara", "Orelope", "Ori Ire", "Oyo East", "Oyo West", "Saki East", "Saki West", "Surulere"],
  Plateau: ["Barkin Ladi", "Bassa", "Bokkos", "Jos East", "Jos North", "Jos South", "Kanam", "Kanke", "Langtang North", "Langtang South", "Mangu", "Mikang", "Pankshin", "Qua'an Pan", "Riyom", "Shendam", "Wase"],
  Rivers: ["Abua/Odual", "Ahoada East", "Ahoada West", "Akuku-Toru", "Andoni", "Asari-Toru", "Bonny", "Degema", "Eleme", "Emohua", "Etche", "Gokana", "Ikwerre", "Khana", "Obio/Akpor", "Ogba/Egbema/Ndoni", "Ogu/Bolo", "Okrika", "Omuma", "Opobo/Nkoro", "Oyigbo", "Port Harcourt", "Tai"],
  Sokoto: ["Binji", "Bodinga", "Dange Shuni", "Gada", "Goronyo", "Gudu", "Gwadabawa", "Illela", "Isa", "Kebbe", "Kware", "Rabah", "Sabon Birni", "Shagari", "Silame", "Sokoto North", "Sokoto South", "Tambuwal", "Tangaza", "Tureta", "Wamako", "Wurno", "Yabo"],
  Taraba: ["Ardo Kola", "Bali", "Donga", "Gashaka", "Gassol", "Ibi", "Jalingo", "Karim Lamido", "Kumi", "Lau", "Sardauna", "Takum", "Ussa", "Wukari", "Yorro", "Zing"],
  Yobe: ["Bade", "Bursari", "Damaturu", "Fika", "Fune", "Geidam", "Gujba", "Gulani", "Jakusko", "Karasuwa", "Machina", "Nangere", "Nguru", "Potiskum", "Tarmuwa", "Yunusari", "Yusufari"],
  Zamfara: ["Anka", "Bakura", "Birnin Magaji/Kiyaw", "Bukkuyum", "Bungudu", "Gummi", "Gusau", "Kaura Namoda", "Maradun", "Maru", "Shinkafi", "Talata Mafara", "Tsafe", "Zurmi"],
};

export const DEFAULT_APPLICANT_CATEGORIES = [
  'Music',
  'Acting',
  'Comedy',
  'Dance',
  'Content Creation',
  'Film Production',
  'STEM / Innovation',
  'SME Pitch',
  'School Talent',
  'Campus Talent',
  'Open Mic',
  'General Reality Show',
  'Other',
];

export const TALENT_SKILL_OPTIONS = [
  'Singing',
  'Rapping',
  'Songwriting',
  'Music Production',
  'Acting',
  'Comedy',
  'Dance',
  'Content Creation',
  'Film Production',
  'STEM / Innovation',
  'SME Pitch',
  'Public Speaking',
  'Presenting',
  'Instrumentalist',
  'Spoken Word',
];

const CONTEST_CATEGORY_SKILL_MAP: Record<string, string[]> = {
  music: ['Singing', 'Rapping', 'Songwriting', 'Music Production', 'Instrumentalist'],
  acting: ['Acting', 'Presenting', 'Public Speaking', 'Content Creation'],
  comedy_content: ['Comedy', 'Content Creation', 'Public Speaking', 'Presenting'],
  dance: ['Dance', 'Content Creation'],
  film_production: ['Film Production', 'Acting', 'Content Creation'],
  stem_innovation: ['STEM / Innovation', 'Public Speaking'],
  sme_pitch: ['SME Pitch', 'Public Speaking', 'Presenting'],
  school_campus: ['STEM / Innovation', 'Content Creation', 'Public Speaking', 'Presenting'],
  open_mic: ['Singing', 'Rapping', 'Spoken Word', 'Comedy', 'Instrumentalist'],
  general_reality_show: ['Singing', 'Acting', 'Comedy', 'Dance', 'Content Creation', 'Public Speaking'],
  other: [...TALENT_SKILL_OPTIONS],
};

export function getTalentSkillsForContestCategory(categoryKey: string) {
  const allowed = CONTEST_CATEGORY_SKILL_MAP[categoryKey] || CONTEST_CATEGORY_SKILL_MAP.other;
  return TALENT_SKILL_OPTIONS.filter((option) => allowed.includes(option));
}

export const MEDICAL_CONDITION_OPTIONS = [
  'Asthma',
  'Hypertension',
  'Diabetes',
  'Epilepsy',
  'Sickle Cell',
  'Ulcer',
  'Migraine',
  'None',
];

export const HEALTH_STATUS_OPTIONS = [
  'Generally healthy',
  'Physically fit for strenuous activity',
  'Managing a chronic condition',
  'Currently on medication',
  'Under ongoing medical care',
  'Has a physical limitation',
  'Has a mental/emotional health consideration',
  'No known health issues',
];

export const ALLERGY_OPTIONS = [
  'Peanuts',
  'Seafood',
  'Dairy',
  'Egg',
  'Dust',
  'Pollen',
  'Medication',
  'None',
];

export const contestRegistrationCatalog: ContestRegistrationDefinition[] = [
  {
    slug: 'reality-tv-show',
    title: 'Spotlight Reality TV Show',
    contestCategory: 'general_reality_show',
    contestType: 'housemate_reality_show',
    seasonOrEdition: 'Season 1',
    regionScope: 'national',
    isPaid: true,
    registrationFeeNgn: 5000,
    requiresGuardianConsentForMinors: true,
    legalAdultAge: 18,
    requiresMedical: true,
    requiresBootcampReadiness: true,
    supportsVoting: true,
    supportsAuditionScheduling: true,
    supportsSchoolEntry: false,
    supportsGroupEntry: false,
    auditionStates: [...NIGERIA_STATES],
    applicantCategories: ['General Reality Show', 'Music', 'Acting', 'Dance', 'Comedy', 'Content Creation'],
    categoryQuestionSet: 'general_reality_show',
  },
  {
    slug: 'stem-contest',
    title: 'Spotlight STEM Contest',
    contestCategory: 'stem_innovation',
    contestType: 'hybrid_contest',
    seasonOrEdition: '2026',
    regionScope: 'national',
    isPaid: false,
    requiresGuardianConsentForMinors: true,
    legalAdultAge: 18,
    requiresMedical: false,
    requiresBootcampReadiness: false,
    supportsVoting: true,
    supportsAuditionScheduling: false,
    supportsSchoolEntry: true,
    supportsGroupEntry: true,
    auditionStates: [...NIGERIA_STATES],
    applicantCategories: ['STEM / Innovation', 'School Talent', 'Campus Talent'],
    categoryQuestionSet: 'stem_innovation',
  },
  {
    slug: 'sme-pitch-contest',
    title: 'Spotlight SME Pitch Contest',
    contestCategory: 'sme_pitch',
    contestType: 'pitch_competition',
    seasonOrEdition: '2026',
    regionScope: 'national',
    isPaid: false,
    requiresGuardianConsentForMinors: false,
    legalAdultAge: 18,
    requiresMedical: false,
    requiresBootcampReadiness: false,
    supportsVoting: true,
    supportsAuditionScheduling: true,
    supportsSchoolEntry: false,
    supportsGroupEntry: true,
    auditionStates: [...NIGERIA_STATES],
    applicantCategories: ['SME Pitch', 'Entrepreneur', 'Startup'],
    categoryQuestionSet: 'sme_pitch',
  },
  {
    slug: 'open-mic-competition',
    title: 'Spotlight Open Mic Competition',
    contestCategory: 'open_mic',
    contestType: 'public_voting_contest',
    seasonOrEdition: '2026',
    regionScope: 'regional',
    isPaid: true,
    registrationFeeNgn: 2000,
    requiresGuardianConsentForMinors: true,
    legalAdultAge: 16,
    requiresMedical: false,
    requiresBootcampReadiness: false,
    supportsVoting: true,
    supportsAuditionScheduling: true,
    supportsSchoolEntry: false,
    supportsGroupEntry: true,
    auditionStates: [...NIGERIA_STATES],
    applicantCategories: ['Open Mic', 'Music', 'Spoken Word'],
    categoryQuestionSet: 'open_mic',
  },
  {
    slug: 'film-academy',
    title: 'Spotlight Film Academy',
    contestCategory: 'film_production',
    contestType: 'bootcamp_reality_show',
    seasonOrEdition: 'Cohort 2026',
    regionScope: 'national',
    isPaid: true,
    registrationFeeNgn: 7500,
    requiresGuardianConsentForMinors: true,
    legalAdultAge: 18,
    requiresMedical: true,
    requiresBootcampReadiness: true,
    supportsVoting: false,
    supportsAuditionScheduling: true,
    supportsSchoolEntry: false,
    supportsGroupEntry: true,
    auditionStates: [...NIGERIA_STATES],
    applicantCategories: ['Film Production', 'Acting', 'Content Creation'],
    categoryQuestionSet: 'film_production',
  },
];

export function resolveContestRegistration(slug: string) {
  return contestRegistrationCatalog.find((item) => item.slug === slug) || null;
}
