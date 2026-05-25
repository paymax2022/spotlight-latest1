export const programApplicationConfigBySlug = {
  'reality-tv-show': {
    formType: 'talentRegistration',
    heading: 'Reality TV Show Application',
    helperText:
      'Complete this form to join the next season screening process. Shortlisted applicants will receive audition instructions and timelines.',
    fields: [
      { name: 'fullName', label: 'Full Name', required: true, placeholder: 'Enter your full name' },
      { name: 'stageName', label: 'Stage Name', placeholder: 'Enter your stage name (optional)' },
      { name: 'email', label: 'Email Address', type: 'email', required: true, placeholder: 'Enter your email address' },
      { name: 'phone', label: 'Phone Number', type: 'tel', required: true, placeholder: 'Enter your phone number' },
      { name: 'location', label: 'Location (City / State)', required: true, placeholder: 'Enter your location' },
      {
        name: 'category',
        label: 'Performance Category',
        type: 'select',
        required: true,
        options: ['Music', 'Dance', 'Comedy', 'Acting', 'Spoken Word', 'Other'],
      },
      { name: 'portfolioLink', label: 'Audition Video / Portfolio Link', type: 'url', placeholder: 'Paste a valid URL' },
      { name: 'bio', label: 'Short Bio', type: 'textarea', required: true, placeholder: 'Tell us about your creative journey' },
    ],
  },
  'stem-contest': {
    formType: 'contestRegistration',
    heading: 'STEM Contest Application',
    helperText:
      'Submit your project details for technical screening. Eligible entries will be invited to pitch and demonstration rounds.',
    fields: [
      { name: 'applicantName', label: 'Applicant / Team Name', required: true, placeholder: 'Enter applicant or team name' },
      {
        name: 'applicantType',
        label: 'Applicant Type',
        type: 'select',
        required: true,
        options: ['Individual', 'School Team', 'Community Team', 'Startup Team'],
      },
      { name: 'institution', label: 'School / Organization', required: true, placeholder: 'Enter school or organization' },
      { name: 'projectTitle', label: 'Project Title', required: true, placeholder: 'Enter project title' },
      { name: 'focusArea', label: 'Focus Area', required: true, placeholder: 'AI, Robotics, Health Tech, Agritech, etc.' },
      { name: 'description', label: 'Problem and Solution Summary', type: 'textarea', required: true, placeholder: 'Describe the problem and your proposed solution' },
      { name: 'prototypeLink', label: 'Prototype / Demo Link', type: 'url', placeholder: 'Paste a valid URL' },
      { name: 'email', label: 'Email Address', type: 'email', required: true, placeholder: 'Enter your email address' },
      { name: 'phone', label: 'Phone Number', type: 'tel', required: true, placeholder: 'Enter your phone number' },
    ],
  },
  'sme-pitch-contest': {
    formType: 'contestRegistration',
    heading: 'SME Pitch Contest Application',
    helperText:
      'Apply as a founder or business team. Selected ventures will move into coaching and live pitch stages.',
    fields: [
      { name: 'businessName', label: 'Business Name', required: true, placeholder: 'Enter business name' },
      { name: 'founderName', label: 'Founder / Team Lead', required: true, placeholder: 'Enter founder or team lead name' },
      { name: 'industry', label: 'Industry', required: true, placeholder: 'Fintech, Food, Fashion, SaaS, etc.' },
      {
        name: 'businessStage',
        label: 'Business Stage',
        type: 'select',
        required: true,
        options: ['Idea Stage', 'Early Traction', 'Revenue Stage', 'Growth Stage'],
      },
      { name: 'pitchTitle', label: 'Pitch Title', required: true, placeholder: 'Enter your pitch title' },
      { name: 'problemSolution', label: 'Problem and Solution', type: 'textarea', required: true, placeholder: 'Explain the problem and your business solution' },
      { name: 'deckLink', label: 'Pitch Deck / Profile Link', type: 'url', placeholder: 'Paste a valid URL' },
      { name: 'email', label: 'Email Address', type: 'email', required: true, placeholder: 'Enter your email address' },
      { name: 'phone', label: 'Phone Number', type: 'tel', required: true, placeholder: 'Enter your phone number' },
    ],
  },
  'open-mic-competition': {
    formType: 'talentRegistration',
    heading: 'Open Mic Competition Application',
    helperText:
      'Short application for the monthly open mic beat challenge. Approved artists receive beat access and submission instructions.',
    fields: [
      { name: 'fullName', label: 'Full Name', required: true, placeholder: 'Enter your full name' },
      { name: 'stageName', label: 'Stage Name', required: true, placeholder: 'Enter your stage name' },
      { name: 'email', label: 'Email Address', type: 'email', required: true, placeholder: 'Enter your email address' },
      { name: 'phone', label: 'Phone Number', type: 'tel', required: true, placeholder: 'Enter your phone number' },
    ],
  },
  'film-academy': {
    formType: 'talentRegistration',
    heading: 'Film Academy Application',
    helperText:
      'Apply to join a practical Film Academy cohort. Eligible applicants will receive screening and cohort onboarding updates.',
    fields: [
      { name: 'fullName', label: 'Full Name', required: true, placeholder: 'Enter your full name' },
      { name: 'email', label: 'Email Address', type: 'email', required: true, placeholder: 'Enter your email address' },
      { name: 'phone', label: 'Phone Number', type: 'tel', required: true, placeholder: 'Enter your phone number' },
      {
        name: 'track',
        label: 'Preferred Track',
        type: 'select',
        required: true,
        options: ['Acting', 'Script Writing', 'Directing', 'Production', 'Cinematography', 'Editing'],
      },
      {
        name: 'experienceLevel',
        label: 'Experience Level',
        type: 'select',
        required: true,
        options: ['Beginner', 'Intermediate', 'Advanced'],
      },
      { name: 'availability', label: 'Availability', required: true, placeholder: 'Weekdays, weekends, full-time, etc.' },
      { name: 'portfolioLink', label: 'Portfolio / Showreel Link', type: 'url', placeholder: 'Paste a valid URL' },
      { name: 'motivation', label: 'Why do you want to join?', type: 'textarea', required: true, placeholder: 'Share your goals and expectations' },
    ],
  },
};
