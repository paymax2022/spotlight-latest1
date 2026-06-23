import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { listSchools, registerSchool } from '@/src/server/stem/persistence';
import type { StemSchool } from '@/src/features/stem/types';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const status = (searchParams.get('status') as StemSchool['status']) || undefined;
    const schools = await listSchools(status);
    return successResponse({ success: true, schools });
  } catch (error) {
    return handleApiError(error, 'Failed to list STEM schools');
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      schoolName?: string;
      schoolType?: string;
      ownershipType?: string;
      schoolCategory?: string;
      registrationNumber?: string;
      yearEstablished?: number;
      officialEmail?: string;
      officialPhone?: string;
      website?: string;
      address?: string;
      country?: string;
      state?: string;
      lga?: string;
      city?: string;
      nearestLandmark?: string;
      schoolLogo?: string;
      campusPhoto?: string;
      schoolDescription?: string;
      adminContact?: {
        fullName?: string;
        designation?: string;
        email?: string;
        phone?: string;
        whatsapp?: string;
        preferredContactMethod?: string;
      };
      verificationDocuments?: string[];
    };

    if (!body.schoolName?.trim()) return errorResponse('schoolName is required', 400);
    if (!body.schoolType?.trim()) return errorResponse('schoolType is required', 400);
    if (!body.adminContact?.fullName?.trim()) return errorResponse('adminContact.fullName is required', 400);
    if (!body.adminContact?.email?.trim()) return errorResponse('adminContact.email is required', 400);
    if (!body.adminContact?.phone?.trim()) return errorResponse('adminContact.phone is required', 400);

    const school = await registerSchool({
      schoolName: body.schoolName,
      schoolType: body.schoolType,
      ownershipType: body.ownershipType,
      schoolCategory: body.schoolCategory,
      registrationNumber: body.registrationNumber,
      yearEstablished: body.yearEstablished,
      officialEmail: body.officialEmail,
      officialPhone: body.officialPhone,
      website: body.website,
      address: body.address,
      country: body.country,
      state: body.state,
      lga: body.lga,
      city: body.city,
      nearestLandmark: body.nearestLandmark,
      schoolLogo: body.schoolLogo,
      campusPhoto: body.campusPhoto,
      schoolDescription: body.schoolDescription,
      adminContact: {
        fullName: body.adminContact.fullName,
        designation: body.adminContact.designation,
        email: body.adminContact.email,
        phone: body.adminContact.phone,
        whatsapp: body.adminContact.whatsapp,
        preferredContactMethod: body.adminContact.preferredContactMethod,
      },
      verificationDocuments: body.verificationDocuments || [],
    });

    return successResponse({ success: true, school }, 201);
  } catch (error) {
    return handleApiError(error, 'Failed to register school');
  }
}
