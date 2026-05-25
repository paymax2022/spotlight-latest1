import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { createSchoolJoinRequest, listSchoolJoinRequests } from '@/src/server/stem/persistence';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const schoolId = searchParams.get('schoolId') || undefined;
    const requests = await listSchoolJoinRequests(schoolId);
    return successResponse({ success: true, requests });
  } catch (error) {
    return handleApiError(error, 'Failed to list school join requests');
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      schoolId?: string;
      studentUserId?: string;
      fullName?: string;
      email?: string;
      phone?: string;
      studentId?: string;
      classLevel?: string;
      department?: string;
      studentIdUpload?: string;
      admissionLetterUpload?: string;
      mentorName?: string;
      note?: string;
    };

    if (!body.schoolId) return errorResponse('schoolId is required', 400);
    if (!body.fullName) return errorResponse('fullName is required', 400);

    const requestRow = await createSchoolJoinRequest({
      schoolId: body.schoolId,
      studentUserId: body.studentUserId,
      fullName: body.fullName,
      email: body.email,
      phone: body.phone,
      studentId: body.studentId,
      classLevel: body.classLevel,
      department: body.department,
      studentIdUpload: body.studentIdUpload,
      admissionLetterUpload: body.admissionLetterUpload,
      mentorName: body.mentorName,
      note: body.note,
    });

    return successResponse({ success: true, request: requestRow }, 201);
  } catch (error) {
    return handleApiError(error, 'Failed to create school join request');
  }
}
