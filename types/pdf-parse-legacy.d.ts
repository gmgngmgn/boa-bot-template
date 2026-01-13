declare module "pdf-parse/lib/pdf-parse.js" {
  type PdfParseResult = {
    text: string;
    numpages?: number;
    numrender?: number;
    info?: Record<string, unknown> | null;
    metadata?: Record<string, unknown> | null;
    version?: string | null;
  };

  type PdfParseOptions = {
    pagerender?: (pageData: any) => Promise<string> | string;
    max?: number;
    abridge?: boolean;
    version?: string;
  };

  function pdfParse(
    dataBuffer: Buffer | ArrayBuffer | Uint8Array,
    options?: PdfParseOptions
  ): Promise<PdfParseResult>;

  export default pdfParse;
}

