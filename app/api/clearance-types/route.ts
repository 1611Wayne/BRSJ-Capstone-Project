import { NextResponse } from 'next/server';
import { getClearanceTypes } from '@/lib/clearanceTypesSource';

// GET /api/clearance-types: the active clearance types (public information) and where they came from.
export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json(await getClearanceTypes());
}
