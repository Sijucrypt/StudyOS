import { createRequire } from "node:module";
import { dirname, join, posix } from "node:path";
import { fromBuffer } from "yauzl";
import { SaxesParser } from "saxes";

const MAX_XML = 8_000_000;
const MAX_TEXT = 500_000;
const MAX_ENTRIES = 2_000;
const MAX_PDF_PAGES = 250;
const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const pdfAssets = dirname(createRequire(import.meta.url).resolve("pdfjs-dist/package.json"));
const pdfAssetDirectory = (name) => join(pdfAssets, name).replaceAll("\\", "/") + "/";

function utf8(buffer) {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text)) throw new Error("Binary content in text file.");
  return text;
}

function openZip(buffer) {
  return new Promise((resolve, reject) => {
    fromBuffer(buffer, { lazyEntries: true, validateEntrySizes: true, strictFileNames: true },
      (error, zip) => error ? reject(error) : resolve(zip));
  });
}

async function officeParts(buffer, type, readText) {
  const zip = await openZip(buffer);
  try {
    if (zip.entryCount > MAX_ENTRIES) throw new Error("Too many ZIP entries.");
    return await new Promise((resolve, reject) => {
      const parts = [];
      const slides = new Map();
      const metadata = new Map();
      const seen = new Set();
      let manifest = false;
      let main = false;
      let totalBytes = 0;
      zip.on("error", reject);
      zip.on("end", () => {
        if (!manifest || !main) reject(new Error("Office package does not match its extension."));
        else if (type === "pptx" && readText) {
          try {
            resolve(presentationParts(metadata, slides));
          } catch (error) {
            reject(error);
          }
        } else resolve(parts);
      });
      zip.on("entry", (entry) => {
        const name = entry.fileName;
        if (seen.has(name) || /vbaProject|vbaData|activex/i.test(name) || entry.generalPurposeBitFlag & 1) {
          reject(new Error("Duplicate, encrypted, or active Office content."));
          return;
        }
        seen.add(name);
        const isManifest = name === "[Content_Types].xml";
        if (isManifest) manifest = true;
        if (name === (type === "docx" ? "word/document.xml" : "ppt/presentation.xml")) main = true;
        const slide = type === "pptx" && /^ppt\/slides\/[^/]+\.xml$/.test(name);
        const presentationMetadata = type === "pptx" && (name === "ppt/presentation.xml" || name === "ppt/_rels/presentation.xml.rels");
        const document = type === "docx" && name === "word/document.xml";
        if (!readText || (!slide && !document && !presentationMetadata)) {
          zip.readEntry();
          return;
        }
        totalBytes += entry.uncompressedSize;
        if (totalBytes > MAX_XML) {
          reject(new Error("Office text exceeds the parsing limit."));
          return;
        }
        zip.openReadStream(entry, (error, stream) => {
          if (error) {
            reject(error);
            return;
          }
          const chunks = [];
          let bytes = 0;
          stream.on("error", reject);
          stream.on("data", (chunk) => {
            bytes += chunk.length;
            if (bytes > entry.uncompressedSize || bytes > MAX_XML) {
              stream.destroy(new Error("Invalid expanded ZIP size."));
              return;
            }
            chunks.push(chunk);
          });
          stream.on("end", () => {
            try {
              const xml = utf8(Buffer.concat(chunks));
              if (presentationMetadata) metadata.set(name, xml);
              else if (slide) slides.set(name, xmlText(xml, type));
              else parts.push({ page: null, text: xmlText(xml, type) });
              zip.readEntry();
            } catch (failure) {
              reject(failure);
            }
          });
        });
      });
      zip.readEntry();
    });
  } finally {
    zip.close();
  }
}

function parseOfficeXml(xml, onTag) {
  const parser = new SaxesParser({ xmlns: true });
  parser.on("doctype", () => { throw new Error("Office document contains a DTD."); });
  parser.on("error", (error) => { throw error; });
  parser.on("opentag", onTag);
  parser.write(xml).close();
}

function presentationParts(metadata, slides) {
  const presentation = metadata.get("ppt/presentation.xml");
  const relationships = metadata.get("ppt/_rels/presentation.xml.rels");
  if (!presentation || !relationships) throw new Error("Presentation slide order is unavailable.");
  const targets = new Map();
  parseOfficeXml(relationships, (tag) => {
    const attributes = tag.attributes;
    const target = attributes.Target?.value;
    const id = attributes.Id?.value;
    if (tag.local !== "Relationship" || !id || !target || attributes.TargetMode?.value === "External"
      || !attributes.Type?.value.endsWith("/slide")) return;
    const path = target.startsWith("/") ? posix.normalize(target).slice(1) : posix.join("ppt", target);
    if (slides.has(path)) targets.set(id, path);
  });
  const parts = [];
  let page = 0;
  parseOfficeXml(presentation, (tag) => {
    if (tag.local !== "sldId" || !tag.uri.endsWith("/presentationml/2006/main") &&
      !tag.uri.endsWith("/presentationml/main")) return;
    page += 1;
    const id = Object.values(tag.attributes).find((attribute) =>
      attribute.local === "id" && attribute.uri.endsWith("/relationships"))?.value;
    const text = slides.get(targets.get(id));
    if (text) parts.push({ page, text });
  });
  return parts;
}

function xmlText(xml, type) {
  const section = type === "docx" ? "wordprocessingml" : "drawingml";
  const namespace = (uri) => uri === "http://schemas.openxmlformats.org/" + section + "/2006/main"
    || uri === "http://purl.oclc.org/ooxml/" + section + "/main";
  const parser = new SaxesParser({ xmlns: true });
  let inText = false;
  let text = "";
  parser.on("doctype", () => { throw new Error("Office document contains a DTD."); });
  parser.on("error", (error) => { throw error; });
  parser.on("opentag", (tag) => {
    if (namespace(tag.uri) && tag.local === "t") inText = true;
  });
  parser.on("text", (value) => {
    if (inText && text.length < MAX_TEXT) text += value;
  });
  parser.on("closetag", (tag) => {
    if (!namespace(tag.uri)) return;
    if (tag.local === "t") inText = false;
    if (tag.local === "p" && text.length < MAX_TEXT) text += "\n";
  });
  parser.write(xml).close();
  return text.slice(0, MAX_TEXT);
}

export async function verifyBytes(buffer, mime) {
  switch (mime) {
    case "application/pdf":
      if (!/^%PDF-[12]\.\d/.test(buffer.subarray(0, 8).toString("ascii"))) throw new Error("Invalid PDF signature.");
      break;
    case "image/png":
      if (buffer.length < 33 || !buffer.subarray(0, 8).equals(PNG) || buffer.toString("ascii", 12, 16) !== "IHDR") {
        throw new Error("Invalid PNG signature.");
      }
      break;
    case "image/jpeg":
      if (buffer.length < 8 || !buffer.subarray(0, 3).equals(Buffer.from([255, 216, 255]))) {
        throw new Error("Invalid JPEG signature.");
      }
      break;
    case "text/plain":
    case "text/markdown":
      utf8(buffer);
      break;
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
      await officeParts(buffer, "docx", false);
      break;
    case "application/vnd.openxmlformats-officedocument.presentationml.presentation":
      await officeParts(buffer, "pptx", false);
      break;
    default:
      throw new Error("Unsupported file type.");
  }
}

export function chunkText(parts) {
  const chunks = [];
  let available = MAX_TEXT;
  for (const { page, text } of parts) {
    const clean = text.replaceAll("\x00", "").trim().slice(0, available).toWellFormed();
    available -= clean.length;
    for (let offset = 0; offset < clean.length;) {
      let end = Math.min(offset + 1500, clean.length);
      if (end < clean.length) {
        const split = clean.lastIndexOf(" ", end);
        if (split > offset + 1000) end = split;
      }
      chunks.push({ text: clean.slice(offset, end).toWellFormed(), page_start: page, page_end: page });
      if (end === clean.length) break;
      offset = end - 150;
    }
    if (!available) break;
  }
  return chunks;
}

export async function extractBytes(buffer, mime) {
  if (mime.startsWith("image/")) return { status: "unsupported", chunks: [], page_count: null };
  if (mime === "application/pdf") {
    const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const task = getDocument({
      data: Uint8Array.from(buffer),
      isEvalSupported: false,
      disableFontFace: true,
      useSystemFonts: false,
      useWasm: false,
      stopAtErrors: true,
      cMapUrl: pdfAssetDirectory("cmaps"),
      standardFontDataUrl: pdfAssetDirectory("standard_fonts"),
    });
    try {
      const pdf = await task.promise;
      if (pdf.numPages > MAX_PDF_PAGES) throw new Error("PDF exceeds the page parsing limit.");
      const parts = [];
      let remaining = MAX_TEXT;
      for (let i = 1; i <= pdf.numPages && remaining > 0; i++) {
        const page = await pdf.getPage(i);
        try {
          const { items } = await page.getTextContent();
          const text = items.map((item) => "str" in item ? item.str + (item.hasEOL ? "\n" : " ") : "").join("");
          const bounded = text.slice(0, remaining);
          parts.push({ page: i, text: bounded });
          remaining -= bounded.length;
        } finally {
          page.cleanup();
        }
      }
      const chunks = chunkText(parts);
      return { status: chunks.length ? "ready" : "needs_ocr", chunks, page_count: pdf.numPages };
    } finally {
      await task.destroy();
    }
  }
  if (mime === "text/plain" || mime === "text/markdown") {
    return { status: "ready", chunks: chunkText([{ page: null, text: utf8(buffer) }]), page_count: null };
  }
  const parts = await officeParts(buffer, mime.includes("presentationml") ? "pptx" : "docx", true);
  return { status: "ready", chunks: chunkText(parts), page_count: null };
}
