import { NextRequest, NextResponse } from 'next/server';
import { tasks } from '@trigger.dev/sdk/v3';
import { v4 as uuidv4 } from 'uuid';

type CSVImportRow = {
  documentName: string;
  docUrl: string;
  externalLink?: string;
};

type CSVImportRequest = {
  rows: CSVImportRow[];
  targetTable: 'documents' | 'student_documents';
};

export async function POST(req: NextRequest) {
  try {
    const body: CSVImportRequest = await req.json();
    const { rows, targetTable } = body;

    if (!rows || !Array.isArray(rows) || rows.length === 0) {
      return NextResponse.json({ error: 'No rows provided' }, { status: 400 });
    }

    if (!targetTable || !['documents', 'student_documents'].includes(targetTable)) {
      return NextResponse.json({ error: 'Invalid target table' }, { status: 400 });
    }

    // Validate rows
    for (const row of rows) {
      if (!row.documentName?.trim()) {
        return NextResponse.json({ error: 'All rows must have a Document Name' }, { status: 400 });
      }
      if (!row.docUrl?.trim()) {
        return NextResponse.json({ error: 'All rows must have a Doc URL' }, { status: 400 });
      }
    }

    const batchId = uuidv4();
    const userId = '00000000-0000-0000-0000-000000000001';

    // Trigger the batch processing task
    await tasks.trigger('process-csv-batch', {
      batchId,
      userId,
      rows,
      targetTable,
    });

    return NextResponse.json({
      success: true,
      batchId,
      rowCount: rows.length,
    });
  } catch (error) {
    console.error('CSV import error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
