export const FILE_LIMIT = 25_000_000;
export const BUCKET = "studyos-materials";
export const RESUMABLE_THRESHOLD = 6_000_000;

const types = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  txt: "text/plain",
  md: "text/markdown",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  png: "image/png",
};

export function materialType(name) {
  const extension = name.toLowerCase().split(".").at(-1);
  return extension && name.includes(".") && Object.hasOwn(types, extension) ? types[extension] : null;
}
