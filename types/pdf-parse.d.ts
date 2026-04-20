declare module 'pdf-parse' {
  type PdfTextItem = {
    str?: string;
    transform?: number[];
  };

  type PdfPageData = {
    getTextContent: () => Promise<{ items: PdfTextItem[] }>;
  };

  type PdfParseOptions = {
    pagerender?: (pageData: PdfPageData) => Promise<string> | string;
    max?: number;
    version?: string;
  };

  type PdfParseResult = {
    numpages: number;
    numrender: number;
    info: Record<string, unknown>;
    metadata: unknown;
    text: string;
    version: string;
  };

  function pdfParse(dataBuffer: Buffer, options?: PdfParseOptions): Promise<PdfParseResult>;

  export = pdfParse;
}
