import { serve } from "inngest/next";
import { inngest } from "../../../inngest/client";
import { youtubeTranscript, transcribeVideo, extractDocumentText, ingestDocument } from "../../../inngest/functions";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    youtubeTranscript,
    transcribeVideo,
    extractDocumentText,
    ingestDocument,
  ],
});

