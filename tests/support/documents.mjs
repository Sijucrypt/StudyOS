import { crc32 } from "node:zlib";

export function pdfFixture(text = "StudyOS test page") {
  const stream = "BT /F1 12 Tf 50 100 Td (" + text + ") Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 180] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Length " + stream.length + " >>\nstream\n" + stream + "\nendstream",
  ];
  let pdf = "%PDF-1.7\n";
  const offsets = objects.map((object, index) => {
    const offset = pdf.length;
    pdf += (index + 1) + " 0 obj\n" + object + "\nendobj\n";
    return offset;
  });
  const xref = pdf.length;
  pdf += "xref\n0 6\n0000000000 65535 f \n";
  for (const offset of offsets) pdf += String(offset).padStart(10, "0") + " 00000 n \n";
  return Buffer.from(pdf + "trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n" + xref + "\n%%EOF\n");
}

export function zipFixture(files) {
  const body = [];
  const directory = [];
  let offset = 0;
  for (const [path, text] of Object.entries(files)) {
    const name = Buffer.from(path);
    const bytes = Buffer.from(text);
    const crc = crc32(bytes);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(bytes.length, 18);
    local.writeUInt32LE(bytes.length, 22);
    local.writeUInt16LE(name.length, 26);
    body.push(local, name, bytes);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(bytes.length, 20);
    central.writeUInt32LE(bytes.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    directory.push(central, name);
    offset += local.length + name.length + bytes.length;
  }
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(directory.length / 2, 8);
  end.writeUInt16LE(directory.length / 2, 10);
  end.writeUInt32LE(directory.reduce((sum, item) => sum + item.length, 0), 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...body, ...directory, end]);
}
