// The BHECO Digital Data Collection Form (formVersion 2). Mirrors the Google
// Form section by section. Keep in sync with
// BHECO-HOME-CARE/src/lib/visitFormDefinition.ts — the frontend renders and
// validates from its copy, this copy is the server-side source of truth.
//
// Field types: text | tel | textarea | date | select | radio | checkbox
// (multi-select, stored as string[]) | confirm (single "Yes, I confirm" box,
// stored as boolean) | file (stored as { id, name, mimeType, size }).
// showIf hides a section/field unless another field has the given value;
// hidden fields are never required and are dropped on save.

const { CONSTITUENCIES_BY_COUNTY } = require('./kenyaConstituencies');

const FORM_VERSION = 2;

const YES_NO = ['Yes', 'No'];

const SECTIONS = [
  {
    id: 'fieldVisit',
    title: 'Field Visit Information',
    fields: [
      { name: 'fieldOfficerName', label: 'Field Officer Name', type: 'text', required: true },
      { name: 'fieldOfficerPhone', label: 'Field Officer Phone Number', type: 'tel', required: true },
      { name: 'visitDate', label: 'Date of Visit', type: 'date', required: true },
      {
        name: 'visitTypes',
        label: 'Type of Visit',
        hint: 'Tick where applicable',
        type: 'checkbox',
        required: true,
        options: [
          'New Beneficiary Registration',
          'Follow-up Visit',
          'Referral Follow-up',
          'Intervention/Support Visit',
          'Oral History/Impact Story',
          'Other',
        ],
      },
      {
        name: 'referenceNumber',
        label: 'Beneficiary/Household Reference Number',
        hint: 'Use the unique BHECO reference number assigned to the beneficiary/household (BHECO-ward-number), e.g. BHECO-NK-001. For a new beneficiary, fill in the Ward and tap Generate new ID.',
        type: 'text',
        required: true,
      },
      { name: 'villageArea', label: 'Village/Area', type: 'text', required: true },
      { name: 'ward', label: 'Ward', type: 'text', required: true },
      {
        name: 'constituency',
        label: 'Constituency',
        type: 'select',
        required: true,
        optionGroups: CONSTITUENCIES_BY_COUNTY.map((g) => ({ label: g.county, options: g.options })),
        options: CONSTITUENCIES_BY_COUNTY.flatMap((g) => g.options),
      },
    ],
  },
  {
    id: 'beneficiary',
    title: 'Beneficiary Details',
    fields: [
      { name: 'beneficiaryName', label: 'Full Name of Beneficiary', type: 'text', required: true },
      { name: 'age', label: 'Age', type: 'text', required: true },
      { name: 'weight', label: 'Weight', type: 'text', required: true },
      { name: 'registeredSha', label: 'Registered with SHA', type: 'radio', required: true, options: YES_NO },
      {
        name: 'receivingStipend',
        label: 'Receiving Government Older Persons Stipend',
        type: 'radio',
        required: true,
        options: YES_NO,
      },
      { name: 'gender', label: 'Gender', type: 'radio', required: true, options: ['Male', 'Female'] },
      { name: 'nationalId', label: 'National ID Number', type: 'text' },
      { name: 'beneficiaryPhone', label: 'Beneficiary Phone Number', type: 'tel' },
      {
        name: 'physicalAddress',
        label: 'Physical Address / Directions to Household',
        type: 'textarea',
        required: true,
      },
      {
        name: 'livingArrangement',
        label: 'Current Living Arrangement',
        hint: 'Only tick where applicable',
        type: 'checkbox',
        required: true,
        options: [
          'Lives alone',
          'Lives with spouse',
          'Lives with children',
          'Lives with relatives',
          'Lives with caregiver',
          'Other',
        ],
      },
    ],
  },
  {
    id: 'nextOfKin',
    title: 'Next of Kin / Caregiver',
    fields: [
      { name: 'nokName', label: 'Name of Next of Kin / Caregiver', type: 'text', required: true },
      { name: 'nokRelationship', label: 'Relationship to Beneficiary', type: 'text', required: true },
      { name: 'nokPhone', label: 'Phone Number', type: 'tel', required: true },
      { name: 'nokAddress', label: 'Physical Address', type: 'textarea' },
    ],
  },
  {
    id: 'consent',
    title: 'Consent',
    fields: [
      {
        name: 'purposeExplained',
        label: 'Has the purpose of this data collection been explained to the beneficiary/caregiver?',
        type: 'radio',
        required: true,
        options: YES_NO,
      },
      {
        name: 'consentDataCollection',
        label: 'Does the beneficiary/caregiver consent to BHECO collecting this information?',
        type: 'radio',
        required: true,
        options: YES_NO,
      },
      { name: 'consentPhotography', label: 'Consent for Photography', type: 'radio', required: true, options: YES_NO },
      { name: 'consentAudio', label: 'Consent for Audio Recording', type: 'radio', required: true, options: YES_NO },
      { name: 'consentVideo', label: 'Consent for Video Recording', type: 'radio', required: true, options: YES_NO },
      {
        name: 'consentStoryUse',
        label: 'Consent for Use of Story/Quote for BHECO Communication',
        type: 'radio',
        required: true,
        options: YES_NO,
      },
    ],
  },
  {
    id: 'health',
    title: 'Health & Wellbeing Assessment',
    fields: [
      {
        name: 'generalHealth',
        label: 'General Health Status',
        type: 'radio',
        required: true,
        options: ['Good', 'Fair', 'Poor', 'Requires urgent attention'],
      },
      {
        name: 'mobilityStatus',
        label: 'Mobility Status',
        type: 'radio',
        required: true,
        options: ['Fully mobile', 'Experiences difficulty walking', 'Requires assistance', 'Uses wheelchair', 'Bed-bound'],
      },
      {
        name: 'healthcareAccess',
        label: 'Does the beneficiary have access to regular healthcare?',
        type: 'radio',
        required: true,
        options: ['Yes', 'No', 'Occasionally'],
      },
      {
        name: 'healthCondition',
        label: 'Does the beneficiary currently have any known health condition requiring support?',
        type: 'radio',
        required: true,
        options: ['Yes', 'No', 'Unknown'],
      },
      {
        name: 'healthConditionDetails',
        label: 'If yes, briefly describe the condition or support required.',
        type: 'textarea',
        showIf: { field: 'healthCondition', equals: 'Yes' },
      },
      {
        name: 'foodSecurity',
        label: 'Food Security Situation',
        type: 'radio',
        required: true,
        options: ['Adequate access to food', 'Sometimes lacks food', 'Frequently lacks food', 'Severe food insecurity'],
      },
      {
        name: 'hygiene',
        label: 'Hygiene Situation',
        type: 'radio',
        required: true,
        options: ['Adequate', 'Needs some support', 'Poor', 'Urgent concern'],
      },
      {
        name: 'shelter',
        label: 'Shelter/Living Condition',
        type: 'radio',
        required: true,
        options: ['Adequate', 'Needs improvement', 'Poor', 'Unsafe'],
      },
      {
        name: 'isolation',
        label: 'Does the beneficiary experience loneliness or social isolation?',
        type: 'radio',
        required: true,
        options: ['No', 'Occasionally', 'Frequently', 'Severe isolation'],
      },
      {
        name: 'assistiveDevice',
        label: 'Does the beneficiary require an assistive device?',
        type: 'radio',
        required: true,
        options: ['No', 'Wheelchair', 'Walking Aid', 'Other assistive device', 'Unsure'],
      },
      {
        name: 'urgentConcern',
        label: 'Have you identified an urgent medical, protection, food, shelter or welfare concern?',
        type: 'radio',
        required: true,
        options: YES_NO,
      },
    ],
  },
  {
    id: 'urgent',
    title: 'Urgent Case & Referral',
    showIf: { field: 'urgentConcern', equals: 'Yes' },
    fields: [
      {
        name: 'urgentConcernTypes',
        label: 'What is the nature of the urgent concern?',
        hint: 'Only tick where applicable',
        type: 'checkbox',
        required: true,
        options: [
          'Medical Emergency',
          'Severe food insecurity',
          'Unsafe shelter',
          'Neglect',
          'Abuse/protection concern',
          'Severe mobility limitation',
          'Lack of caregiver',
          'Mental/psychosocial concern',
          'Other',
        ],
      },
      { name: 'urgentConcernDescription', label: 'Describe the urgent concern', type: 'textarea', required: true },
      {
        name: 'immediateActions',
        label: 'Immediate Action Taken',
        type: 'checkbox',
        required: true,
        options: [
          'Referred to health facility',
          'Contacted family/caregiver',
          'Contacted relevant government office',
          'Provided immediate BHECO assistance',
          'Escalated to BHECO management',
          'Other',
        ],
      },
      { name: 'referralMade', label: 'Referral Made', type: 'radio', required: true, options: YES_NO },
      {
        name: 'referralDestination',
        label: 'Referral Destination',
        type: 'text',
        showIf: { field: 'referralMade', equals: 'Yes' },
      },
      { name: 'followUpRequired', label: 'Follow-up Required', type: 'radio', required: true, options: YES_NO },
      {
        name: 'followUpDate',
        label: 'Follow-up Date',
        type: 'date',
        showIf: { field: 'followUpRequired', equals: 'Yes' },
      },
    ],
  },
  {
    id: 'support',
    title: 'Support & Intervention Tracking',
    fields: [
      {
        name: 'supportProvided',
        label: 'What support has BHECO provided during this visit?',
        hint: 'Only tick where applicable',
        type: 'checkbox',
        required: true,
        options: [
          'Food',
          'Clothing',
          'Blanket',
          'Maasai Shuka',
          'Hygiene Supplies',
          'Medical Screening',
          'Medical Supplies',
          'Wheelchair',
          'Walking/assistive device',
          'Psychosocial Support',
          'Counselling',
          'Household visits',
          'Kitchen Garden Support',
          'Other',
          'No Support Provided',
        ],
      },
      { name: 'supportDescription', label: 'Describe the support provided', type: 'textarea', required: true },
      { name: 'supportDate', label: 'Date Support Was Provided', type: 'date', required: true },
      {
        name: 'supportReceived',
        label: 'Was the support received by the beneficiary/caregiver?',
        type: 'radio',
        required: true,
        options: ['Yes', 'No', 'Partially'],
      },
      { name: 'partnerDonor', label: 'Name of Partner/Donor Supporting This Intervention', type: 'text' },
    ],
  },
  {
    id: 'kitchenGarden',
    title: 'Kitchen Garden Programme',
    fields: [
      {
        name: 'gardenEligible',
        label: 'Is this household eligible for the BHECO Kitchen Garden Programme?',
        type: 'radio',
        required: true,
        options: ['Yes', 'No', 'Assessment required'],
      },
      {
        name: 'hasKitchenGarden',
        label: 'Does the household currently have a kitchen garden?',
        type: 'radio',
        required: true,
        options: YES_NO,
      },
      {
        name: 'gardenLinked',
        label: 'Has BHECO linked this household to kitchen-garden support?',
        type: 'radio',
        required: true,
        options: ['Yes', 'No', 'Pending'],
      },
      {
        name: 'gardenStatus',
        label: 'Kitchen Garden Status',
        type: 'radio',
        required: true,
        options: ['Not started', 'Site identified', 'Garden Established', 'Crops Planted', 'Producing Food'],
      },
      { name: 'gardenEstablishedDate', label: 'Date Garden Was Established', type: 'date' },
      {
        name: 'cropsPlanted',
        label: 'What crops are planted?',
        type: 'checkbox',
        required: true,
        options: ['Sukuma Wiki', 'Spinach', 'Cabbage', 'Tomato', 'Onions', 'Traditional Vegetables', 'Other'],
      },
      {
        name: 'gardenFurtherSupport',
        label: 'Does the household require further garden support?',
        type: 'radio',
        required: true,
        options: YES_NO,
      },
      { name: 'gardenFollowUpDate', label: 'Kitchen Garden Follow-up Date', type: 'date' },
    ],
  },
  {
    id: 'oralHistory',
    title: 'Oral History & Impact Story',
    fields: [
      {
        name: 'storyBefore',
        label: "What was the elder's situation before receiving support?",
        type: 'textarea',
        required: true,
      },
      { name: 'storySupport', label: 'What support did BHECO provide?', type: 'textarea', required: true },
      { name: 'storyChange', label: 'What has changed as a result?', type: 'textarea', required: true },
      { name: 'storyHopes', label: 'What does the elder hope for in the future?', type: 'textarea', required: true },
      {
        name: 'storyQuote',
        label: 'Powerful Quote from the Elder',
        hint: "Capture the elder's own words as accurately as possible",
        type: 'textarea',
        required: true,
      },
      {
        name: 'recommendImpactStory',
        label: 'Would you recommend this beneficiary for a BHECO impact story?',
        type: 'radio',
        required: true,
        options: ['Yes', 'No', 'Requires Review'],
      },
    ],
  },
  {
    id: 'media',
    title: 'Media & Evidence',
    fields: [
      { name: 'photo', label: 'Upload Beneficiary Photograph', type: 'file', fileKind: 'image' },
      { name: 'photoAdditional', label: 'Upload additional Beneficiary Photograph if needed', type: 'file', fileKind: 'image' },
      { name: 'videoInterview', label: 'Upload Video Interview', type: 'file', fileKind: 'video' },
      { name: 'supportingDocument', label: 'Upload Supporting Document, Where Applicable', type: 'file', fileKind: 'document' },
      {
        name: 'evidenceComplete',
        label: 'Is the required evidence complete?',
        type: 'radio',
        required: true,
        options: ['Yes', 'No', 'Requires verification'],
      },
    ],
  },
  {
    id: 'observations',
    title: 'Field Officer Observations',
    fields: [
      {
        name: 'importantNeeds',
        label: 'What are the most important needs identified during this visit?',
        type: 'textarea',
        required: true,
      },
      {
        name: 'immediateFollowUp',
        label: 'What immediate follow-up should BHECO undertake?',
        type: 'textarea',
        required: true,
      },
      { name: 'additionalComments', label: 'Additional Comments', type: 'textarea' },
    ],
  },
  {
    id: 'declaration',
    title: 'Field Officer Declaration',
    fields: [
      {
        name: 'declarationAccurate',
        label: 'I confirm that the information provided in this form was collected accurately and respectfully.',
        type: 'confirm',
        required: true,
      },
      {
        name: 'declarationConsent',
        label: 'I confirm that appropriate consent was obtained before collecting identifiable photographs, audio, video or beneficiary stories.',
        type: 'confirm',
        required: true,
      },
      { name: 'declarationOfficerName', label: 'Field Officer Name', type: 'text', required: true },
      { name: 'submissionDate', label: 'Submission Date', type: 'date', required: true },
    ],
  },
];

const FILE_KINDS = {
  image: { maxBytes: 10 * 1024 * 1024, mimePrefixes: ['image/'] },
  video: { maxBytes: 100 * 1024 * 1024, mimePrefixes: ['video/'] },
  document: {
    maxBytes: 10 * 1024 * 1024,
    mimePrefixes: [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.oasis.opendocument.text',
      'text/plain',
    ],
  },
};

const MAX_TEXT_LENGTH = 10000;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isVisible(rule, values) {
  return !rule || values[rule.field] === rule.equals;
}

// Returns { data, errors }. `data` holds only known, visible fields, cleaned
// (trimmed strings, deduped option arrays); `errors` maps field name to a
// message. File fields are only shape-checked here — the caller must confirm
// the referenced upload ids exist.
function validateVisitForm(input) {
  const values = input && typeof input === 'object' ? input : {};
  const data = {};
  const errors = {};

  for (const section of SECTIONS) {
    if (!isVisible(section.showIf, values)) continue;

    for (const field of section.fields) {
      if (!isVisible(field.showIf, values)) continue;
      const raw = values[field.name];

      switch (field.type) {
        case 'checkbox': {
          const list = Array.isArray(raw) ? raw : raw == null || raw === false ? [] : [raw];
          const picked = [...new Set(list)];
          if (picked.some((v) => !field.options.includes(v))) {
            errors[field.name] = 'Invalid option selected';
          } else if (field.required && picked.length === 0) {
            errors[field.name] = 'Select at least one option';
          } else {
            data[field.name] = field.options.filter((o) => picked.includes(o));
          }
          break;
        }
        case 'confirm': {
          if (field.required && raw !== true) {
            errors[field.name] = 'This confirmation is required';
          } else {
            data[field.name] = raw === true;
          }
          break;
        }
        case 'file': {
          if (raw == null || raw === '') {
            data[field.name] = null;
          } else if (typeof raw !== 'object' || typeof raw.id !== 'string') {
            errors[field.name] = 'Invalid file';
          } else {
            data[field.name] = { id: raw.id };
          }
          break;
        }
        default: {
          const value = raw == null ? '' : raw;
          if (typeof value !== 'string') {
            errors[field.name] = 'Invalid value';
            break;
          }
          const trimmed = value.trim();
          if (field.required && trimmed === '') {
            errors[field.name] = 'This field is required';
          } else if (trimmed.length > MAX_TEXT_LENGTH) {
            errors[field.name] = 'Too long';
          } else if (trimmed && field.options && !field.options.includes(trimmed)) {
            errors[field.name] = 'Invalid option selected';
          } else if (trimmed && field.type === 'date' && !DATE_PATTERN.test(trimmed)) {
            errors[field.name] = 'Invalid date';
          } else {
            data[field.name] = trimmed;
          }
        }
      }
    }
  }

  return { data, errors };
}

// Answers carried over from a beneficiary's last visit when a follow-up is
// started. Weight is left out on purpose: it should be measured each visit.
const PREFILL_FIELDS = [
  'villageArea',
  'ward',
  'constituency',
  ...SECTIONS.filter((s) => s.id === 'beneficiary' || s.id === 'nextOfKin')
    .flatMap((s) => s.fields.map((f) => f.name))
    .filter((name) => name !== 'weight'),
];

function fileFields() {
  return SECTIONS.flatMap((s) => s.fields.filter((f) => f.type === 'file'));
}

// "BHECO - nk - 001" and "BHECO-NK-001" are the same household.
function normalizeReferenceNumber(value) {
  return value.replace(/\s+/g, '').toUpperCase();
}

module.exports = {
  FORM_VERSION,
  SECTIONS,
  FILE_KINDS,
  validateVisitForm,
  fileFields,
  PREFILL_FIELDS,
  normalizeReferenceNumber,
};
