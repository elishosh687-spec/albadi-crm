/**
 * Upload the new company intro video to Vercel Blob and print its public URL
 * (which then gets set as the GREEN_COMPANY_VIDEO_URL env var in Vercel).
 *
 *   BLOB_READ_WRITE_TOKEN=… npx tsx scripts/_upload-intro-blob.ts
 */
import { put } from "@vercel/blob";
import { readFile } from "fs/promises";

async function main() {
  const buf = await readFile("/tmp/albadi-intro-v2-small.mp4");
  console.log(`uploading ${buf.length.toLocaleString()} bytes…`);
  const res = await put("company-intro-v2.mp4", buf, {
    access: "public",
    contentType: "video/mp4",
    allowOverwrite: true,
  });
  console.log("\n✅ uploaded");
  console.log("URL:       ", res.url);
  console.log("downloadUrl:", res.downloadUrl);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
