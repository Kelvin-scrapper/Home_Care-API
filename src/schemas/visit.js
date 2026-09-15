const { z } = require('zod');

const visitFormSchema = z.object({
  beneficiaryName: z.string().min(1, 'Name is required'),
  age: z.string().min(1, 'Age is required'),
  weight: z.string(),
  location: z.string().min(1, 'Location is required'),
  timeInCommunity: z.string(),
  volunteerName: z.string().min(1, 'Volunteer name is required'),
  visitDate: z.string().min(1, 'Visit date is required'),

  // Part 1
  appearance: z.enum(['Good', 'Fair', 'poor']).optional(),
  mobilityChallenges: z.enum(['Yes', 'No']).optional(),
  signsOfIllness: z.enum(['Yes', 'No']).optional(),
  screeningDone: z.enum(['BP', 'Diabetes', 'N/A']).optional(),

  hadMeals: z.enum(['Yes', 'No', 'Unsure']).optional(),
  foodInHome: z.enum(['Yes', 'No']).optional(),
  cleanWater: z.enum(['Yes', 'No']).optional(),

  houseClean: z.enum(['Yes', 'No']).optional(),
  beddingAdequate: z.enum(['Yes', 'No']).optional(),
  sanitationAccess: z.enum(['Yes', 'No']).optional(),
  receivingStipend: z.enum(['Yes', 'No']).optional(),

  mood: z.enum(['Happy', 'Calm', 'Sad', 'Distressed']).optional(),
  signsOfNeglect: z.enum(['Yes', 'No']).optional(),
  socialSupport: z.enum(['Yes', 'No']).optional(),
  registeredSHA: z.enum(['Yes', 'No']).optional(),

  needsIdentified: z.string(),
  actionsRecommendations: z.string(),
  urgencyLevel: z.enum(['Routine', 'Follow-up Needed', 'Urgent']).optional(),

  // Part 2
  backgroundChallenges: z.string(),
  interventionChange: z.string(),
  youthParticipation: z.string(),
  futureAspirations: z.string(),

  // Consent & Signature
  consentInterview: z.enum(['Yes', 'No']).optional(),
  consentPhotoVideo: z.enum(['Yes', 'No']).optional(),
  beneficiarySignature: z.string(),
  volunteerSignature: z.string(),
  dateSigned: z.string(),
});

module.exports = { visitFormSchema };
